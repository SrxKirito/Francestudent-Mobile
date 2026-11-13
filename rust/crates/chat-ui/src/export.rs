pub struct ExportedFile {
    pub name: String,
    pub mime: &'static str,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Copy)]
pub struct FileExporter(pub fn(ExportedFile) -> Result<&'static str, &'static str>);
