use dioxus::prelude::*;
use francestudent::{
    AccountActivity, AccountQuota, Error, FranceStudent, TOKEN_ACTIVITY_DAYS, TokenDay,
};
use time::{Date, Duration, UtcOffset};

use crate::{ChatState, MobilePage};

#[component]
pub(crate) fn Activity(mut state: Signal<ChatState>) -> Element {
    let mut revision = use_signal(|| 0_u64);
    let report = use_resource(move || async move {
        let _ = revision();
        let client = state.peek().client.clone();
        match client {
            Some(client) => Some(load(client).await),
            None => None,
        }
    });
    let loading = report.pending();
    let data = report.read();

    rsx! {
        section { class: "mobile-page mobile-activity", aria_label: "Activité du compte",
            div { class: "mobile-page-header",
                h2 { "Activité du compte" }
                button { r#type: "button", disabled: loading,
                    onclick: move |_| revision += 1,
                    "Actualiser"
                }
                button { r#type: "button",
                    onclick: move |_| state.write().mobile_page = MobilePage::Settings,
                    "Réglages"
                }
            }
            if loading {
                p { role: "status", class: "muted", "Chargement de l’activité…" }
            }
            if let Some(Some((quota, activity))) = data.as_ref() {
                match quota {
                    Ok(Some(quota)) => rsx! { Quota { quota: quota.clone() } },
                    Ok(None) => rsx! { p { class: "muted", "Le service ne fournit pas de budget de chat." } },
                    Err(error) => rsx! { p { class: "error", role: "alert", "Budget du chat : {error}" } },
                }
                match activity {
                    Ok(activity) => rsx! { History { activity: activity.clone() } },
                    Err(error) => rsx! { p { class: "error", role: "alert", "Activité du compte : {error}" } },
                }
            }
        }
    }
}

async fn load(
    client: FranceStudent,
) -> (
    Result<Option<AccountQuota>, Error>,
    Result<AccountActivity, Error>,
) {
    tokio::join!(client.account_quota(), client.account_activity())
}

#[component]
fn Quota(quota: AccountQuota) -> Element {
    let estimate = if quota.uncertain { "Environ " } else { "" };
    let remaining = quota
        .remaining_percent
        .map(|remaining| format!(" · {} % restants", percent(remaining)));
    let reset = quota.reset_at.map(|time| {
        let date = time.to_offset(UtcOffset::UTC);
        format!(
            "Remise à zéro le {} à {:02}:{:02} UTC",
            day_label(date.date()),
            date.hour(),
            date.minute()
        )
    });
    let used = percent(quota.used_percent);
    let remaining = remaining.unwrap_or_default();
    rsx! {
        section { class: "activity-quota", aria_label: "Budget du chat",
            h3 { "Budget du chat" }
            progress { aria_label: "Budget du chat utilisé", max: "100", value: quota.used_percent.min(100.0) }
            p { "{estimate}{used} % utilisés{remaining}" }
            if let Some(reset) = reset {
                p { class: "muted", "{reset}" }
            }
        }
    }
}

#[component]
fn History(activity: AccountActivity) -> Element {
    let mut selected = use_signal(|| None::<Date>);
    let total = sum(&activity.days, |day| day.total);
    let input = sum(&activity.days, |day| day.input);
    let output = sum(&activity.days, |day| day.output);
    let reasoning = sum(&activity.days, |day| day.reasoning);
    let count = activity.days.iter().filter(|day| day.total > 0).count();
    let peak = activity
        .days
        .iter()
        .map(|day| day.total)
        .max()
        .unwrap_or_default();
    let first = activity
        .through
        .saturating_sub(Duration::days((TOKEN_ACTIVITY_DAYS - 1) as i64));
    let period = (0..TOKEN_ACTIVITY_DAYS)
        .rev()
        .filter_map(|index| activity.through.checked_sub(Duration::days(index as i64)));
    let selection =
        selected().map(|date| (date, activity.days.iter().find(|day| day.date == date)));

    rsx! {
        section { class: "activity-history", aria_label: "Historique des tokens",
            h3 { "Activité sur les 343 derniers jours" }
            if let Some(lifetime) = activity.lifetime {
                p { "{number(lifetime)} tokens depuis la création du compte" }
            }
            if activity.days.is_empty() {
                p { class: "muted", "Le service ne fournit aucun historique journalier pour cette période." }
            } else {
                p { "{number(total)} tokens · {count} jours actifs · {activity.days.len()} jours renseignés" }
                div { class: "activity-calendar-scroll", tabindex: "0", aria_label: "Activité quotidienne",
                    div { class: "activity-calendar",
                        for date in period {
                            {
                                let cell_id = format!("token-day-{date}");
                                let day = activity.days.binary_search_by_key(&date, |day| day.date)
                                    .ok().map(|index| &activity.days[index]);
                                let label = match day {
                                    Some(day) => format!("{} · {} tokens", day_label(date), number(day.total)),
                                    None => format!("{} · aucune donnée", day_label(date)),
                                };
                                let intensity = day.map(|day| match day.total {
                                    0 => 0,
                                    tokens => (u128::from(tokens) * 4).div_ceil(u128::from(peak.max(1))) as u8,
                                });
                                let class = intensity.map_or_else(|| "activity-day unreported".to_owned(), |level| format!("activity-day level-{level}"));
                                rsx! {
                                    button {
                                        key: "{date}", r#type: "button", class,
                                        id: cell_id,
                                        aria_label: label.clone(), title: label,
                                        aria_pressed: selected() == Some(date),
                                        tabindex: if selected().unwrap_or(activity.through) == date { "0" } else { "-1" },
                                        onfocus: move |_| selected.set(Some(date)),
                                        onclick: move |_| selected.set(Some(date)),
                                        onkeydown: move |event| {
                                            let offset = match event.key() {
                                                Key::ArrowUp => -1,
                                                Key::ArrowDown => 1,
                                                Key::ArrowLeft => -7,
                                                Key::ArrowRight => 7,
                                                _ => return,
                                            };
                                            event.prevent_default();
                                            if let Some(date) = date.checked_add(Duration::days(offset))
                                                .filter(|date| (first..=activity.through).contains(date))
                                            {
                                                selected.set(Some(date));
                                                dioxus_document::eval(&format!(
                                                    "document.getElementById('token-day-{date}')?.focus()"
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if let Some((date, day)) = selection {
                    p { class: "muted", role: "status",
                        if let Some(day) = day {
                            "{day_label(date)} · {number(day.total)} tokens"
                        } else {
                            "{day_label(date)} · aucune donnée"
                        }
                    }
                }
                dl { class: "activity-metrics",
                    dt { "Entrée" }
                    dd { "{number(input)}" }
                    dt { "Sortie" }
                    dd { "{number(output)}" }
                    dt { "Réflexion" }
                    dd { "{number(reasoning)}" }
                    dt { "Pic journalier" }
                    dd { "{number(peak)}" }
                }
            }
        }
    }
}

fn day_label(date: Date) -> String {
    format!(
        "{:02}/{:02}/{}",
        date.day(),
        u8::from(date.month()),
        date.year()
    )
}

fn sum(days: &[TokenDay], field: impl Fn(&TokenDay) -> u64) -> u64 {
    days.iter().map(field).fold(0, u64::saturating_add)
}

fn number(value: u64) -> String {
    let digits = value.to_string();
    let mut result = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            result.push('\u{202f}');
        }
        result.push(digit);
    }
    result
}

fn percent(value: f64) -> String {
    format!("{value:.1}")
        .replace('.', ",")
        .trim_end_matches(",0")
        .to_owned()
}
