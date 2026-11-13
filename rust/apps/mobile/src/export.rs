use chat_ui::ExportedFile;

const MAX_BYTES: usize = 50 * 1024 * 1024;
const FAILED: &str = "Impossible d’enregistrer le fichier sur cet appareil.";

pub fn save(file: ExportedFile) -> Result<&'static str, &'static str> {
    if file.bytes.is_empty() || file.bytes.len() > MAX_BYTES {
        return Err("Le fichier est vide ou dépasse 50 Mio.");
    }
    let name = file.name.as_str();
    if name.starts_with('.')
        || name.trim().is_empty()
        || name.len() > 200
        || name.contains(['/', '\\', ':'])
        || name.chars().any(char::is_control)
    {
        return Err("Le nom du fichier est invalide.");
    }
    platform::save(file)
}

#[cfg(target_os = "android")]
mod platform {
    use std::{
        fs::File,
        io::Write,
        os::fd::{FromRawFd, OwnedFd},
    };

    use jni::{
        JNIEnv, JavaVM,
        objects::{JObject, JValue},
    };

    use super::{ExportedFile, FAILED};

    pub fn save(file: ExportedFile) -> Result<&'static str, &'static str> {
        let context = ndk_context::android_context();
        // SAFETY: Tao supplies the VM and a global Activity reference for the
        // lifetime of the UI. The attached thread only borrows that reference.
        let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }.map_err(|_| FAILED)?;
        let activity = unsafe { JObject::from_raw(context.context().cast()) };
        let mut env = vm.attach_current_thread().map_err(|_| FAILED)?;
        let result = env.with_local_frame(32, |env| -> Result<_, jni::errors::Error> {
            save_to_downloads(env, &activity, &file)
        });
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
        match result {
            Ok(true) => Ok("Enregistré dans Téléchargements / FranceStudent."),
            Ok(false) => {
                Err("L’export dans Téléchargements nécessite Android 10 ou une version ultérieure.")
            }
            Err(_) => Err(FAILED),
        }
    }

    fn save_to_downloads<'a>(
        env: &mut JNIEnv<'a>,
        activity: &JObject<'_>,
        file: &ExportedFile,
    ) -> jni::errors::Result<bool> {
        let sdk = env
            .get_static_field("android/os/Build$VERSION", "SDK_INT", "I")?
            .i()?;
        if sdk < 29 {
            return Ok(false);
        }
        let resolver = env
            .call_method(
                activity,
                "getContentResolver",
                "()Landroid/content/ContentResolver;",
                &[],
            )?
            .l()?;
        let volume = env.new_string("external_primary")?;
        let downloads = env
            .call_static_method(
                "android/provider/MediaStore$Downloads",
                "getContentUri",
                "(Ljava/lang/String;)Landroid/net/Uri;",
                &[JValue::Object(&volume)],
            )?
            .l()?;
        let values = env.new_object("android/content/ContentValues", "()V", &[])?;
        for (key, value) in [
            ("_display_name", file.name.as_str()),
            ("mime_type", file.mime),
            ("relative_path", "Download/FranceStudent"),
        ] {
            let key = env.new_string(key)?;
            let value = env.new_string(value)?;
            env.call_method(
                &values,
                "put",
                "(Ljava/lang/String;Ljava/lang/String;)V",
                &[JValue::Object(&key), JValue::Object(&value)],
            )?;
        }
        let pending_key = env.new_string("is_pending")?;
        pending(env, &values, &pending_key, 1)?;
        let uri = env
            .call_method(
                &resolver,
                "insert",
                "(Landroid/net/Uri;Landroid/content/ContentValues;)Landroid/net/Uri;",
                &[JValue::Object(&downloads), JValue::Object(&values)],
            )?
            .l()?;
        if uri.is_null() {
            return Err(jni::errors::Error::NullPtr("MediaStore insert"));
        }
        let result = (|| {
            write(env, &resolver, &uri, &file.bytes)?;
            env.call_method(&values, "clear", "()V", &[])?;
            pending(env, &values, &pending_key, 0)?;
            let count = env.call_method(
                &resolver,
                "update",
                "(Landroid/net/Uri;Landroid/content/ContentValues;Ljava/lang/String;[Ljava/lang/String;)I",
                &[
                    JValue::Object(&uri),
                    JValue::Object(&values),
                    JValue::Object(&JObject::null()),
                    JValue::Object(&JObject::null()),
                ],
            )?.i()?;
            if count != 1 {
                return Err(jni::errors::Error::NullPtr("MediaStore update"));
            }
            Ok(true)
        })();
        if result.is_err() {
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_clear();
            }
            let _ = env.call_method(
                &resolver,
                "delete",
                "(Landroid/net/Uri;Ljava/lang/String;[Ljava/lang/String;)I",
                &[
                    JValue::Object(&uri),
                    JValue::Object(&JObject::null()),
                    JValue::Object(&JObject::null()),
                ],
            );
        }
        result
    }

    fn pending(
        env: &mut JNIEnv<'_>,
        values: &JObject<'_>,
        key: &JObject<'_>,
        flag: i32,
    ) -> jni::errors::Result<()> {
        let value = env
            .call_static_method(
                "java/lang/Integer",
                "valueOf",
                "(I)Ljava/lang/Integer;",
                &[JValue::Int(flag)],
            )?
            .l()?;
        env.call_method(
            values,
            "put",
            "(Ljava/lang/String;Ljava/lang/Integer;)V",
            &[JValue::Object(key), JValue::Object(&value)],
        )?;
        Ok(())
    }

    fn write(
        env: &mut JNIEnv<'_>,
        resolver: &JObject<'_>,
        uri: &JObject<'_>,
        bytes: &[u8],
    ) -> jni::errors::Result<()> {
        let mode = env.new_string("w")?;
        let descriptor = env
            .call_method(
                resolver,
                "openFileDescriptor",
                "(Landroid/net/Uri;Ljava/lang/String;)Landroid/os/ParcelFileDescriptor;",
                &[JValue::Object(uri), JValue::Object(&mode)],
            )?
            .l()?;
        let fd = env.call_method(&descriptor, "detachFd", "()I", &[])?.i()?;
        if fd < 0 {
            return Err(jni::errors::Error::NullPtr("MediaStore descriptor"));
        }
        // SAFETY: detachFd has transferred ownership of this descriptor.
        let mut file = File::from(unsafe { OwnedFd::from_raw_fd(fd) });
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| jni::errors::Error::NullPtr("MediaStore write"))
    }
}

#[cfg(target_os = "ios")]
mod platform {
    use std::{fs, io::Write, path::Path};

    use objc2_foundation::{
        NSSearchPathDirectory, NSSearchPathDomainMask, NSSearchPathForDirectoriesInDomains,
    };

    use super::{ExportedFile, FAILED};

    pub fn save(file: ExportedFile) -> Result<&'static str, &'static str> {
        let directories = NSSearchPathForDirectoriesInDomains(
            NSSearchPathDirectory::DocumentDirectory,
            NSSearchPathDomainMask::UserDomainMask,
            true,
        );
        let home = directories.firstObject().ok_or(FAILED)?.to_string();
        let directory = Path::new(&home);
        fs::create_dir_all(directory).map_err(|_| FAILED)?;
        let mut pending = tempfile::NamedTempFile::new_in(directory).map_err(|_| FAILED)?;
        pending.write_all(&file.bytes).map_err(|_| FAILED)?;
        pending.as_file().sync_all().map_err(|_| FAILED)?;
        let name = Path::new(&file.name);
        let stem = name.file_stem().and_then(|s| s.to_str()).ok_or(FAILED)?;
        let extension = name.extension().and_then(|s| s.to_str());
        for index in 0..100 {
            let target = if index == 0 {
                file.name.clone()
            } else if let Some(extension) = extension {
                format!("{stem}-{index}.{extension}")
            } else {
                format!("{stem}-{index}")
            };
            match pending.persist_noclobber(directory.join(target)) {
                Ok(_) => {
                    return Ok("Enregistré dans Fichiers / Sur mon iPhone / FranceStudent Chat.");
                }
                Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                    pending = error.file;
                }
                Err(_) => return Err(FAILED),
            }
        }
        Err("Trop de fichiers portent déjà ce nom.")
    }
}
