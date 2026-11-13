use chat_ui::SecureSessionStore;

pub struct MobileSession;

const SERVICE: &str = "org.francestudent.chat.rustpreview";
const ACCOUNT: &str = "session";
const UNAVAILABLE: &str = "Le coffre système est indisponible.";

impl SecureSessionStore for MobileSession {
    fn load(&self) -> Result<Option<String>, String> {
        platform::load().map_err(str::to_owned)
    }

    fn save(&self, cookie: &str) -> Result<(), String> {
        platform::save(cookie).map_err(str::to_owned)
    }

    fn clear(&self) -> Result<(), String> {
        platform::clear().map_err(str::to_owned)
    }
}

#[cfg(target_os = "android")]
mod platform {
    use android_native_keyring_store::Store;
    use keyring_core::{Entry, Error, api::CredentialStoreApi};

    use super::{ACCOUNT, SERVICE, UNAVAILABLE};

    fn entry() -> Result<Entry, &'static str> {
        Store::new()
            .and_then(|store| store.build(SERVICE, ACCOUNT, None))
            .map_err(|_| UNAVAILABLE)
    }

    pub fn load() -> Result<Option<String>, &'static str> {
        match entry()?.get_password() {
            Ok(cookie) => Ok(Some(cookie)),
            Err(Error::NoEntry) => Ok(None),
            Err(_) => Err(UNAVAILABLE),
        }
    }

    pub fn save(cookie: &str) -> Result<(), &'static str> {
        entry()?.set_password(cookie).map_err(|_| UNAVAILABLE)
    }

    pub fn clear() -> Result<(), &'static str> {
        match entry()?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(_) => Err(UNAVAILABLE),
        }
    }
}

#[cfg(target_os = "ios")]
mod platform {
    use core_foundation::{
        base::TCFType, boolean::CFBoolean, data::CFData, dictionary::CFDictionary, string::CFString,
    };
    use security_framework::{
        access_control::{ProtectionMode, SecAccessControl},
        passwords::{
            PasswordOptions, delete_generic_password_options, generic_password,
            set_generic_password_options,
        },
    };
    use security_framework_sys::{
        base::{errSecItemNotFound, errSecSuccess},
        item::{
            kSecAttrAccount, kSecAttrService, kSecAttrSynchronizable, kSecClass,
            kSecClassGenericPassword, kSecValueData,
        },
        keychain_item::SecItemUpdate,
    };

    use super::{ACCOUNT, SERVICE, UNAVAILABLE};

    fn options() -> PasswordOptions {
        let mut options = PasswordOptions::new_generic_password(SERVICE, ACCOUNT);
        options.set_access_synchronized(Some(false));
        options
    }

    pub fn load() -> Result<Option<String>, &'static str> {
        match generic_password(options()) {
            Ok(cookie) => String::from_utf8(cookie).map(Some).map_err(|_| UNAVAILABLE),
            Err(error) if error.code() == errSecItemNotFound => Ok(None),
            Err(_) => Err(UNAVAILABLE),
        }
    }

    pub fn save(cookie: &str) -> Result<(), &'static str> {
        let status = update(cookie);
        if status == errSecSuccess {
            return Ok(());
        }
        if status != errSecItemNotFound {
            return Err(UNAVAILABLE);
        }
        let mut options = options();
        let access = SecAccessControl::create_with_protection(
            Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
            0,
        )
        .map_err(|_| UNAVAILABLE)?;
        options.set_access_control(access);
        set_generic_password_options(cookie.as_bytes(), options).map_err(|_| UNAVAILABLE)
    }

    fn update(cookie: &str) -> i32 {
        // SAFETY: the keys are framework constants, and the dictionaries and
        // their values live until the synchronous update returns.
        unsafe {
            let query = CFDictionary::from_CFType_pairs(&[
                (
                    CFString::wrap_under_get_rule(kSecClass),
                    CFString::wrap_under_get_rule(kSecClassGenericPassword).into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrService),
                    CFString::from(SERVICE).into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrAccount),
                    CFString::from(ACCOUNT).into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrSynchronizable),
                    CFBoolean::from(false).into_CFType(),
                ),
            ]);
            let value = CFDictionary::from_CFType_pairs(&[(
                CFString::wrap_under_get_rule(kSecValueData),
                CFData::from_buffer(cookie.as_bytes()).into_CFType(),
            )]);
            SecItemUpdate(query.as_concrete_TypeRef(), value.as_concrete_TypeRef())
        }
    }

    pub fn clear() -> Result<(), &'static str> {
        match delete_generic_password_options(options()) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == errSecItemNotFound => Ok(()),
            Err(_) => Err(UNAVAILABLE),
        }
    }
}
