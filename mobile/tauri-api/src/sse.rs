//! Incremental SSE framing. Unknown event types are left to the consumer.
use serde::Serialize;

const MAX_BUFFER: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Event {
    pub id: Option<String>,
    pub event: String,
    pub data: String,
}

#[derive(Default)]
pub struct Parser {
    line: Vec<u8>,
    data: Vec<String>,
    event: String,
    id: Option<String>,
    event_size: usize,
}

impl Parser {
    pub fn feed(&mut self, chunk: &[u8]) -> Result<Vec<Event>, &'static str> {
        let mut events = Vec::new();
        for &byte in chunk {
            if byte == b'\n' {
                if self.line.last() == Some(&b'\r') {
                    self.line.pop();
                }
                let line = std::mem::take(&mut self.line);
                self.process_line(&line, &mut events)?;
            } else {
                self.line.push(byte);
                if self.line.len() + self.event_size > MAX_BUFFER {
                    return Err("Événement SSE trop volumineux");
                }
            }
        }
        Ok(events)
    }

    fn process_line(&mut self, bytes: &[u8], events: &mut Vec<Event>) -> Result<(), &'static str> {
        let line = std::str::from_utf8(bytes).map_err(|_| "Flux SSE non UTF-8")?;
        if line.is_empty() {
            if !self.data.is_empty() {
                events.push(Event {
                    id: self.id.clone(),
                    event: std::mem::take(&mut self.event),
                    data: self.data.join("\n"),
                });
            }
            self.data.clear();
            self.event.clear();
            self.event_size = 0;
        } else if !line.starts_with(':') {
            let (field, value) = line.split_once(':').unwrap_or((line, ""));
            let value = value.strip_prefix(' ').unwrap_or(value);
            match field {
                "data" => {
                    self.event_size += bytes.len() + 1;
                    self.data.push(value.to_owned());
                }
                "event" => self.event = value.to_owned(),
                "id" if !value.contains('\0') => self.id = Some(value.to_owned()),
                _ => (),
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_utf8_keepalive_multiline_and_cursor() {
        let mut p = Parser::default();
        let input = "id: 4\r\nevent: delta\r\ndata: bon\r\ndata: été\r\n\r\n: keepalive\n\ndata: suivant\n\n".as_bytes();
        let mut events = Vec::new();
        for byte in input {
            events.extend(p.feed(&[*byte]).unwrap());
        }
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0],
            Event {
                id: Some("4".into()),
                event: "delta".into(),
                data: "bon\nété".into()
            }
        );
        assert_eq!(events[1].id.as_deref(), Some("4"));
        assert_eq!(events[1].data, "suivant");
    }
    #[test]
    fn oversized_lines_are_rejected() {
        assert!(Parser::default().feed(&vec![b'x'; MAX_BUFFER + 1]).is_err());
    }
}
