mod account_activity;
pub(crate) mod attachments;
mod document_text;
mod projects;
mod settings;
mod web;

pub(super) use account_activity::Activity;
pub(super) use projects::Projects;
pub(super) use settings::Settings;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum MobilePage {
    #[default]
    Chat,
    Projects,
    Settings,
    Activity,
}
