pub(crate) mod attachments;
mod projects;
mod settings;
mod web;

pub(super) use projects::Projects;
pub(super) use settings::Settings;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum MobilePage {
    #[default]
    Chat,
    Projects,
    Settings,
}
