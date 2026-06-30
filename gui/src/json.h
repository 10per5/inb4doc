#pragma once
#include <string>

// JSON utility for the simple key->string extraction we need.
// If we ever need full JSON parsing (nested objects, arrays, typed values),
// replace this with sheredom/json.h — single-header, public-domain, battle-tested:
//   https://github.com/sheredom/json.h

/// Extract the first JSON string value for the given key.
/// Handles leading/trailing whitespace and escaped quotes.
/// Returns empty string if key not found or value is not a string.
inline std::string json_string_value(const std::string &body, const std::string &key)
{
    auto key_start = body.find("\"" + key + "\"");
    if (key_start == std::string::npos) return {};

    auto pos = key_start + key.size() + 2; // past closing quote of key
    while (pos < body.size() && (body[pos] == ' ' || body[pos] == '\t' || body[pos] == ':' || body[pos] == '\n' || body[pos] == '\r'))
        pos++;

    if (pos >= body.size() || body[pos] != '"') return {};

    pos++; // skip opening quote
    std::string result;
    while (pos < body.size())
    {
        char c = body[pos];
        if (c == '"') break;
        if (c == '\\' && pos + 1 < body.size())
        {
            pos++;
            char esc = body[pos];
            switch (esc)
            {
            case '"':  result += '"';  break;
            case '\\': result += '\\'; break;
            case 'n':  result += '\n'; break;
            case 'r':  result += '\r'; break;
            case 't':  result += '\t'; break;
            default:   result += '\\'; result += esc; break;
            }
        }
        else
        {
            result += c;
        }
        pos++;
    }
    return result;
}
