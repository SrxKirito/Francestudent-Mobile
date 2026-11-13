use std::collections::BTreeMap;

use serde_json::Value;
use time::{Date, OffsetDateTime, format_description::well_known::Iso8601};

use super::{Error, FranceStudent};

pub const TOKEN_ACTIVITY_DAYS: usize = 343;

#[derive(Clone, PartialEq)]
pub struct TokenDay {
    pub date: Date,
    pub input: u64,
    pub output: u64,
    pub reasoning: u64,
    pub total: u64,
}

#[derive(Clone, PartialEq)]
pub struct AccountActivity {
    pub days: Vec<TokenDay>,
    pub lifetime: Option<u64>,
    pub through: Date,
}

#[derive(Clone, PartialEq)]
pub struct AccountQuota {
    pub used_percent: f64,
    pub remaining_percent: Option<f64>,
    pub reset_at: Option<OffsetDateTime>,
    pub uncertain: bool,
}

impl FranceStudent {
    pub async fn account_activity(&self) -> Result<AccountActivity, Error> {
        let days = TOKEN_ACTIVITY_DAYS.to_string();
        let data = self
            .get_json(&["user", "tokenusage"], &[("tokenUsageDays", &days)])
            .await?;
        if !data.is_object() {
            return Err(Error::InvalidResponse);
        }
        Ok(activity(&data, OffsetDateTime::now_utc().date()))
    }

    pub async fn account_quota(&self) -> Result<Option<AccountQuota>, Error> {
        let data = self.get_json(&["user", "usage"], &[]).await?;
        if !data.is_object() {
            return Err(Error::InvalidResponse);
        }
        Ok(quota(&data["chatBudget"]))
    }
}

fn activity(data: &Value, through: Date) -> AccountActivity {
    let first = through.saturating_sub(time::Duration::days((TOKEN_ACTIVITY_DAYS - 1) as i64));
    let mut days = BTreeMap::new();
    for row in data["last7DaysTokenUsage"].as_array().into_iter().flatten() {
        let Some(date) = row["date"]
            .as_str()
            .and_then(|date| date.get(..10))
            .and_then(|date| Date::parse(date, &Iso8601::DATE).ok())
            .filter(|date| (first..=through).contains(date))
        else {
            continue;
        };
        let input = tokens(&row["inputTokens"]).unwrap_or_default();
        let output = tokens(&row["outputTokens"]).unwrap_or_default();
        days.insert(
            date,
            TokenDay {
                date,
                input,
                output,
                reasoning: tokens(&row["reasoningTokens"]).unwrap_or_default(),
                total: tokens(&row["totalTokens"]).unwrap_or_else(|| input.saturating_add(output)),
            },
        );
    }
    AccountActivity {
        days: days.into_values().collect(),
        lifetime: tokens(&data["totalTokenCount"]),
        through,
    }
}

fn quota(data: &Value) -> Option<AccountQuota> {
    Some(AccountQuota {
        used_percent: percent(&data["usedPercent"])?,
        remaining_percent: percent(&data["remainingPercent"]),
        reset_at: data["resetAt"].as_str().and_then(|value| {
            OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).ok()
        }),
        uncertain: data["accountingUncertain"] == true,
    })
}

fn tokens(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

fn percent(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|value| value.is_finite() && *value >= 0.0)
}
