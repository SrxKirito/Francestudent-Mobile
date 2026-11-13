use reqwest::{
    Method, StatusCode,
    header::{ACCEPT, ORIGIN},
    multipart::{Form, Part},
};
use serde_json::Value;

use crate::{API, Error, FranceStudent, SITE, checked, string};

pub const MAX_ATTACHMENT_BYTES: usize = 50 * 1024 * 1024;

pub struct AttachmentUpload {
    pub name: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
    pub image: bool,
}

#[derive(Default)]
pub struct UploadedAttachments {
    pub images: Vec<String>,
    pub files: Vec<String>,
}

impl FranceStudent {
    pub async fn upload_attachment(&self, file: AttachmentUpload) -> Result<String, Error> {
        if file.bytes.len() > MAX_ATTACHMENT_BYTES
            || file.name.is_empty()
            || file.name.contains(['\r', '\n', '\0', '/', '\\'])
        {
            return Err(Error::InvalidResponse);
        }
        let route = if file.image {
            "files/upload"
        } else {
            "filesv2"
        };
        let content_type = file.content_type;
        let bytes = bytes::Bytes::from(file.bytes);
        let send = |token: String| {
            let builder = self
                .headers(self.http.request(Method::POST, format!("{API}/{route}")))
                .bearer_auth(token)
                .header(ORIGIN, SITE)
                .header(ACCEPT, "application/json");
            let name = file.name.clone();
            let part = Part::stream_with_length(bytes.clone(), bytes.len() as u64)
                .file_name(name)
                .mime_str(&content_type)
                .map_err(|_| Error::InvalidResponse);
            async move {
                builder
                    .multipart(Form::new().part("file", part?))
                    .send()
                    .await
                    .map_err(|_| Error::Network)
            }
        };
        let response = send(self.token(false).await?).await?;
        let response = if response.status() == StatusCode::UNAUTHORIZED {
            send(self.token(true).await?).await?
        } else {
            response
        };
        let data: Value = checked(response)?
            .json()
            .await
            .map_err(|_| Error::InvalidResponse)?;
        [
            &data["id"],
            &data["uuid"],
            &data["file"]["id"],
            &data["file"]["uuid"],
        ]
        .into_iter()
        .find_map(string)
        .ok_or(Error::InvalidResponse)
    }
}
