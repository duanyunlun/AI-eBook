use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::{Client, RequestBuilder, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::net::IpAddr;
use std::time::Duration;
use thiserror::Error;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProtocol {
    OpenAiChatCompletions,
    OpenAiResponses,
    AnthropicMessages,
    GeminiGenerateContent,
}

#[derive(Clone, Deserialize)]
pub struct ProviderConfig {
    pub protocol: AiProtocol,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    Text { text: String },
    Image { media_type: String, data: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AiMessage {
    pub role: MessageRole,
    pub content: Vec<ContentPart>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GenerateRequest {
    pub messages: Vec<AiMessage>,
    pub max_output_tokens: u32,
    pub temperature: Option<f32>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum StreamEvent {
    TextDelta(String),
    Finished,
}

#[derive(Debug, Error)]
pub enum AiError {
    #[error("AI 服务地址无效：{0}")]
    InvalidBaseUrl(String),
    #[error("AI 服务请求失败：{0}")]
    Network(#[from] reqwest::Error),
    #[error("AI 服务返回 HTTP {status}：{message}")]
    Http { status: u16, message: String },
    #[error("AI 流式响应无效：{0}")]
    Stream(String),
}

pub struct AiClient {
    http: Client,
}

impl AiClient {
    pub fn new() -> Result<Self, AiError> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .tcp_keepalive(Duration::from_secs(30))
            .build()?;
        Ok(Self { http })
    }

    pub async fn generate_stream<F>(
        &self,
        provider: &ProviderConfig,
        request: &GenerateRequest,
        mut emit: F,
    ) -> Result<(), AiError>
    where
        F: FnMut(StreamEvent),
    {
        let response = build_request(&self.http, provider, request)?.send().await?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            return Err(AiError::Http {
                status: status.as_u16(),
                message: error_message(&message),
            });
        }

        let mut events = response.bytes_stream().eventsource();
        while let Some(event) = events.next().await {
            let event = event.map_err(|error| AiError::Stream(error.to_string()))?;
            if event.data == "[DONE]" {
                break;
            }
            for delta in parse_stream_event(provider.protocol, &event.event, &event.data)? {
                emit(StreamEvent::TextDelta(delta));
            }
        }
        emit(StreamEvent::Finished);
        Ok(())
    }
}

fn build_request(
    client: &Client,
    provider: &ProviderConfig,
    request: &GenerateRequest,
) -> Result<RequestBuilder, AiError> {
    let base = validated_base_url(&provider.base_url)?;
    let (url, body) = match provider.protocol {
        AiProtocol::OpenAiChatCompletions => (
            endpoint(&base, "chat/completions")?,
            openai_chat_body(&provider.model, request),
        ),
        AiProtocol::OpenAiResponses => (
            endpoint(&base, "responses")?,
            openai_responses_body(&provider.model, request),
        ),
        AiProtocol::AnthropicMessages => (
            endpoint(&base, "messages")?,
            anthropic_body(&provider.model, request),
        ),
        AiProtocol::GeminiGenerateContent => (
            endpoint(
                &base,
                &format!("models/{}:streamGenerateContent?alt=sse", provider.model),
            )?,
            gemini_body(request),
        ),
    };

    let builder = client.post(url).json(&body);
    Ok(match provider.protocol {
        AiProtocol::OpenAiChatCompletions | AiProtocol::OpenAiResponses => {
            if provider.api_key.is_empty() {
                builder
            } else {
                builder.bearer_auth(&provider.api_key)
            }
        }
        AiProtocol::AnthropicMessages => {
            let builder = builder.header("anthropic-version", "2023-06-01");
            if provider.api_key.is_empty() {
                builder
            } else {
                builder.header("x-api-key", &provider.api_key)
            }
        }
        AiProtocol::GeminiGenerateContent => {
            if provider.api_key.is_empty() {
                builder
            } else {
                builder.header("x-goog-api-key", &provider.api_key)
            }
        }
    })
}

fn validated_base_url(value: &str) -> Result<Url, AiError> {
    let url = Url::parse(value).map_err(|_| AiError::InvalidBaseUrl(value.to_owned()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(AiError::InvalidBaseUrl(value.to_owned()));
    }
    let is_loopback = url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
    });
    if url.scheme() == "http" && !is_loopback {
        return Err(AiError::InvalidBaseUrl(
            "远程服务必须使用 HTTPS，本地服务可使用 HTTP".into(),
        ));
    }
    Ok(url)
}

fn endpoint(base: &Url, path: &str) -> Result<Url, AiError> {
    let mut value = base.as_str().trim_end_matches('/').to_owned();
    value.push('/');
    value.push_str(path);
    Url::parse(&value).map_err(|_| AiError::InvalidBaseUrl(base.to_string()))
}

fn role(role: &MessageRole) -> &'static str {
    match role {
        MessageRole::System => "system",
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
    }
}

fn openai_parts(parts: &[ContentPart], responses: bool) -> Vec<Value> {
    parts
        .iter()
        .map(|part| match part {
            ContentPart::Text { text } => json!({
                "type": if responses { "input_text" } else { "text" },
                "text": text,
            }),
            ContentPart::Image { media_type, data } => json!({
                "type": if responses { "input_image" } else { "image_url" },
                "image_url": if responses {
                    Value::String(format!("data:{media_type};base64,{data}"))
                } else {
                    json!({ "url": format!("data:{media_type};base64,{data}") })
                },
            }),
        })
        .collect()
}

fn openai_chat_body(model: &str, request: &GenerateRequest) -> Value {
    json!({
        "model": model,
        "messages": request.messages.iter().map(|message| json!({
            "role": role(&message.role),
            "content": openai_parts(&message.content, false),
        })).collect::<Vec<_>>(),
        "max_tokens": request.max_output_tokens,
        "temperature": request.temperature,
        "stream": true,
    })
}

fn openai_responses_body(model: &str, request: &GenerateRequest) -> Value {
    json!({
        "model": model,
        "input": request.messages.iter().map(|message| json!({
            "role": role(&message.role),
            "content": openai_parts(&message.content, true),
        })).collect::<Vec<_>>(),
        "max_output_tokens": request.max_output_tokens,
        "temperature": request.temperature,
        "stream": true,
    })
}

fn anthropic_body(model: &str, request: &GenerateRequest) -> Value {
    let system = request
        .messages
        .iter()
        .filter(|message| matches!(message.role, MessageRole::System))
        .flat_map(|message| &message.content)
        .filter_map(|part| match part {
            ContentPart::Text { text } => Some(text.as_str()),
            ContentPart::Image { .. } => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let messages = request
        .messages
        .iter()
        .filter(|message| !matches!(message.role, MessageRole::System))
        .map(|message| {
            let content = message
                .content
                .iter()
                .map(|part| match part {
                    ContentPart::Text { text } => json!({ "type": "text", "text": text }),
                    ContentPart::Image { media_type, data } => json!({
                        "type": "image",
                        "source": { "type": "base64", "media_type": media_type, "data": data },
                    }),
                })
                .collect::<Vec<_>>();
            json!({ "role": role(&message.role), "content": content })
        })
        .collect::<Vec<_>>();
    json!({
        "model": model,
        "system": system,
        "messages": messages,
        "max_tokens": request.max_output_tokens,
        "temperature": request.temperature,
        "stream": true,
    })
}

fn gemini_body(request: &GenerateRequest) -> Value {
    let system_parts = request
        .messages
        .iter()
        .filter(|message| matches!(message.role, MessageRole::System))
        .flat_map(|message| &message.content)
        .filter_map(|part| match part {
            ContentPart::Text { text } => Some(json!({ "text": text })),
            ContentPart::Image { .. } => None,
        })
        .collect::<Vec<_>>();
    let contents = request
        .messages
        .iter()
        .filter(|message| !matches!(message.role, MessageRole::System))
        .map(|message| {
            let parts = message
                .content
                .iter()
                .map(|part| match part {
                    ContentPart::Text { text } => json!({ "text": text }),
                    ContentPart::Image { media_type, data } => {
                        json!({ "inlineData": { "mimeType": media_type, "data": data } })
                    }
                })
                .collect::<Vec<_>>();
            json!({
                "role": if matches!(message.role, MessageRole::Assistant) { "model" } else { "user" },
                "parts": parts,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "systemInstruction": { "parts": system_parts },
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": request.max_output_tokens,
            "temperature": request.temperature,
        },
    })
}

fn parse_stream_event(
    protocol: AiProtocol,
    event_name: &str,
    data: &str,
) -> Result<Vec<String>, AiError> {
    if data.is_empty() {
        return Ok(Vec::new());
    }
    let value: Value =
        serde_json::from_str(data).map_err(|error| AiError::Stream(error.to_string()))?;
    let deltas = match protocol {
        AiProtocol::OpenAiChatCompletions => value["choices"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|choice| choice["delta"]["content"].as_str().map(str::to_owned))
            .collect(),
        AiProtocol::OpenAiResponses => {
            let kind = value["type"].as_str().unwrap_or(event_name);
            if kind == "response.output_text.delta" {
                value["delta"]
                    .as_str()
                    .map(str::to_owned)
                    .into_iter()
                    .collect()
            } else {
                Vec::new()
            }
        }
        AiProtocol::AnthropicMessages => {
            if event_name == "content_block_delta" || value["type"] == "content_block_delta" {
                value["delta"]["text"]
                    .as_str()
                    .map(str::to_owned)
                    .into_iter()
                    .collect()
            } else {
                Vec::new()
            }
        }
        AiProtocol::GeminiGenerateContent => value["candidates"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|candidate| {
                candidate["content"]["parts"]
                    .as_array()
                    .into_iter()
                    .flatten()
            })
            .filter_map(|part| part["text"].as_str().map(str::to_owned))
            .collect(),
    };
    Ok(deltas)
}

fn error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value.pointer("/error/message")?.as_str().map(str::to_owned))
        .unwrap_or_else(|| body.chars().take(500).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> GenerateRequest {
        GenerateRequest {
            messages: vec![AiMessage {
                role: MessageRole::User,
                content: vec![ContentPart::Text {
                    text: "你好".into(),
                }],
            }],
            max_output_tokens: 1024,
            temperature: Some(0.2),
        }
    }

    #[test]
    fn remote_http_is_rejected_but_local_http_is_allowed() {
        assert!(validated_base_url("http://127.0.0.1:11434/v1").is_ok());
        assert!(validated_base_url("http://example.com/v1").is_err());
        assert!(validated_base_url("https://example.com/v1").is_ok());
    }

    #[test]
    fn provider_bodies_keep_the_shared_message() {
        let input = request();
        assert_eq!(
            openai_chat_body("model", &input)["messages"][0]["content"][0]["text"],
            "你好"
        );
        assert_eq!(
            anthropic_body("model", &input)["messages"][0]["content"][0]["text"],
            "你好"
        );
        assert_eq!(
            gemini_body(&input)["contents"][0]["parts"][0]["text"],
            "你好"
        );
    }

    #[test]
    fn parses_all_provider_text_deltas() {
        let cases = [
            (
                AiProtocol::OpenAiChatCompletions,
                "",
                r#"{"choices":[{"delta":{"content":"甲"}}]}"#,
            ),
            (
                AiProtocol::OpenAiResponses,
                "response.output_text.delta",
                r#"{"delta":"乙"}"#,
            ),
            (
                AiProtocol::AnthropicMessages,
                "content_block_delta",
                r#"{"delta":{"type":"text_delta","text":"丙"}}"#,
            ),
            (
                AiProtocol::GeminiGenerateContent,
                "message",
                r#"{"candidates":[{"content":{"parts":[{"text":"丁"}]}}]}"#,
            ),
        ];
        for (protocol, event, data) in cases {
            assert_eq!(parse_stream_event(protocol, event, data).unwrap().len(), 1);
        }
    }

    #[test]
    fn protocols_use_their_own_endpoints_and_auth_headers() {
        let client = Client::new();
        let cases = [
            (
                AiProtocol::OpenAiChatCompletions,
                "chat/completions",
                "authorization",
            ),
            (AiProtocol::OpenAiResponses, "responses", "authorization"),
            (AiProtocol::AnthropicMessages, "messages", "x-api-key"),
            (
                AiProtocol::GeminiGenerateContent,
                "models/model:streamGenerateContent",
                "x-goog-api-key",
            ),
        ];
        for (protocol, path, header) in cases {
            let provider = ProviderConfig {
                protocol,
                base_url: "https://example.com/v1".into(),
                model: "model".into(),
                api_key: "test-key".into(),
            };
            let built = build_request(&client, &provider, &request())
                .unwrap()
                .build()
                .unwrap();
            assert!(built.url().path().ends_with(path));
            assert!(built.headers().contains_key(header));
        }
    }

    #[test]
    fn local_compatible_service_can_run_without_an_api_key() {
        let provider = ProviderConfig {
            protocol: AiProtocol::OpenAiChatCompletions,
            base_url: "http://127.0.0.1:11434/v1".into(),
            model: "local-model".into(),
            api_key: String::new(),
        };
        let built = build_request(&Client::new(), &provider, &request())
            .unwrap()
            .build()
            .unwrap();
        assert!(!built.headers().contains_key("authorization"));
    }
}
