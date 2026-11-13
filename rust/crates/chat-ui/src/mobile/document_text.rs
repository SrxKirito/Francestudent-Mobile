use std::io::{Cursor, Read};

use lopdf::{Document, LoadOptions};
use quick_xml::{Reader, escape::unescape, events::Event};
use zip::ZipArchive;

const MAX_PDF_STREAM: usize = 16 * 1024 * 1024;
const MAX_OFFICE_XML: u64 = 16 * 1024 * 1024;
const OMITTED_CONTENT: &str =
    "[Texte extrait sur le téléphone. Images, mise en page et contenus intégrés omis.]\n";

pub(super) fn supported(name: &str, content_type: &str) -> bool {
    matches!(
        extension(name).as_str(),
        "pdf" | "docx" | "pptx" | "odt" | "odp"
    ) || content_type == "application/pdf"
}

pub(super) fn extract(
    name: &str,
    content_type: &str,
    bytes: &[u8],
    budget: usize,
) -> Option<String> {
    let text_budget = budget.checked_sub(OMITTED_CONTENT.encode_utf16().count())?;
    let extracted = if extension(name) == "pdf" || content_type == "application/pdf" {
        pdf_text(bytes, text_budget)
    } else {
        office_text(name, bytes, text_budget)
    }?;
    Some(format!("{OMITTED_CONTENT}{extracted}"))
}

fn extension(name: &str) -> String {
    name.rsplit_once('.')
        .map_or("", |(_, ext)| ext)
        .to_ascii_lowercase()
}

fn pdf_text(bytes: &[u8], budget: usize) -> Option<String> {
    let document = Document::load_mem_with_options(
        bytes,
        LoadOptions::with_max_decompressed_size(MAX_PDF_STREAM),
    )
    .ok()?;
    let mut result = String::new();
    let pages = document.get_pages().len();
    // L’analyse de fichiers plus longs reste au service. Aucune page n’est tronquée.
    if pages > 200 {
        return None;
    }
    for index in 0..pages {
        let page = u32::try_from(index + 1).ok()?;
        let text = document
            .extract_text_with_limit(&[page], MAX_PDF_STREAM)
            .ok()?;
        // Sans texte sur une page, transmettre le PDF original. Elle peut être scannée.
        if text.trim().is_empty() {
            return None;
        }
        let label = format!("Page {page}\n");
        if result.encode_utf16().count() + label.len() + text.encode_utf16().count() + 1 > budget {
            return None;
        }
        result.push_str(&label);
        result.push_str(text.trim_end());
        result.push('\n');
    }
    (!result.is_empty()).then_some(result)
}

fn office_text(name: &str, bytes: &[u8], budget: usize) -> Option<String> {
    let kind = extension(name);
    let mut archive = ZipArchive::new(Cursor::new(bytes)).ok()?;
    let entries: Vec<(u32, String)> = match kind.as_str() {
        "docx" => {
            let mut sections = vec![(1, "word/document.xml".into())];
            for name in ["word/footnotes.xml", "word/endnotes.xml"] {
                if archive.index_for_name(name).is_some() {
                    sections.push((1, name.into()));
                }
            }
            sections
        }
        "odt" | "odp" => vec![(1, "content.xml".into())],
        "pptx" => {
            let mut slides: Vec<_> = archive
                .file_names()
                .collect::<Result<Vec<_>, _>>()
                .ok()?
                .into_iter()
                .filter_map(|entry| {
                    let number = entry
                        .strip_prefix("ppt/slides/slide")?
                        .strip_suffix(".xml")?
                        .parse::<u32>()
                        .ok()?;
                    Some((number, entry.into_owned()))
                })
                .collect();
            slides.sort_by_key(|(number, _)| *number);
            slides
        }
        _ => return None,
    };
    let mut result = String::new();
    let mut remaining_xml = MAX_OFFICE_XML;
    for (number, entry) in entries {
        let file = archive.by_name(&entry).ok()?;
        if file.size() > remaining_xml {
            return None;
        }
        let mut xml = Vec::new();
        file.take(remaining_xml + 1).read_to_end(&mut xml).ok()?;
        remaining_xml = remaining_xml.checked_sub(xml.len() as u64)?;
        let text = xml_text(
            &xml,
            matches!(kind.as_str(), "odt" | "odp"),
            budget.saturating_sub(result.encode_utf16().count()),
        )?;
        if text.trim().is_empty() {
            if matches!(entry.as_str(), "word/footnotes.xml" | "word/endnotes.xml") {
                continue;
            }
            return None;
        }
        if kind == "pptx" {
            result.push_str(&format!("Diapositive {number}\n"));
        }
        if result.encode_utf16().count() + text.encode_utf16().count() + 1 > budget {
            return None;
        }
        result.push_str(text.trim_end());
        result.push('\n');
    }
    (!result.is_empty()).then_some(result)
}

fn xml_text(xml: &[u8], open_document: bool, budget: usize) -> Option<String> {
    let mut reader = Reader::from_reader(xml);
    let mut output = String::new();
    let mut text_depth: usize = 0;
    let is_text = |name: &[u8]| {
        if open_document {
            matches!(name, b"p" | b"h")
        } else {
            name == b"t"
        }
    };
    loop {
        match reader.read_event().ok()? {
            Event::Start(tag) if is_text(tag.local_name().as_ref()) => text_depth += 1,
            Event::End(tag) if is_text(tag.local_name().as_ref()) => {
                text_depth = text_depth.checked_sub(1)?;
                if open_document {
                    output.push('\n');
                }
            }
            Event::End(tag) if !open_document && tag.local_name().as_ref() == b"p" => {
                output.push('\n')
            }
            Event::Empty(tag)
                if text_depth > 0 && matches!(tag.local_name().as_ref(), b"s" | b"tab") =>
            {
                output.push(' ')
            }
            Event::Empty(tag) if matches!(tag.local_name().as_ref(), b"br" | b"line-break") => {
                output.push('\n')
            }
            Event::Text(text) if text_depth > 0 => output.push_str(&text.decode().ok()?),
            Event::CData(text) if text_depth > 0 => output.push_str(&text.decode().ok()?),
            Event::GeneralRef(reference) if text_depth > 0 => {
                if let Some(character) = reference.resolve_char_ref().ok()? {
                    output.push(character);
                } else {
                    let encoded = format!("&{};", reference.decode().ok()?);
                    output.push_str(&unescape(&encoded).ok()?);
                }
            }
            Event::DocType(_) => return None,
            Event::Eof => return (text_depth == 0).then_some(output),
            _ => {}
        }
        // UTF-8 can take at most three bytes per UTF-16 code unit. Check the exact
        // length at the entry boundary to avoid recounting the string each event.
        if output.len() > budget.saturating_mul(3) {
            return None;
        }
    }
}
