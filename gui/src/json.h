#pragma once
#include <string>
#include <vector>

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

/// Extract all JSON string values for the given key when it holds an array,
/// e.g. `{ "paths": ["a", "b"] }` -> {"a", "b"}.
/// Returns an empty vector if the key is missing, not an array, or malformed.
inline std::vector<std::string> json_string_array(const std::string &body, const std::string &key)
{
    std::vector<std::string> result;
    auto key_start = body.find("\"" + key + "\"");
    if (key_start == std::string::npos) return result;

    auto pos = key_start + key.size() + 2; // past closing quote of key
    while (pos < body.size() && (body[pos] == ' ' || body[pos] == '\t' || body[pos] == ':' || body[pos] == '\n' || body[pos] == '\r'))
        pos++;

    if (pos >= body.size() || body[pos] != '[') return result;
    pos++; // skip '['
    for (;;)
    {
        while (pos < body.size() && (body[pos] == ' ' || body[pos] == '\t' || body[pos] == '\n' || body[pos] == '\r'))
            pos++;
        if (pos >= body.size()) break;
        if (body[pos] == ']') break;
        if (body[pos] != '"')
        {
            // Skip unknown tokens until the next quote or closing bracket.
            pos++;
            continue;
        }
        pos++; // skip opening quote
        std::string value;
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
                case '"':  value += '"';  break;
                case '\\': value += '\\'; break;
                case 'n':  value += '\n'; break;
                case 'r':  value += '\r'; break;
                case 't':  value += '\t'; break;
                default:   value += '\\'; value += esc; break;
                }
            }
            else
            {
                value += c;
            }
            pos++;
        }
        result.push_back(value);
        pos++; // skip closing quote (or advance past end)
    }
    return result;
}

/// JSON-escape a string for embedding in JSON output. Escapes control
/// characters (which would otherwise be a parse error), quotes, and backslashes.
inline std::string json_escape(const std::string &s)
{
    std::string out;
    out.reserve(s.size() + 8);
    static const char *hex = "0123456789abcdef";
    for (unsigned char c : s)
    {
        switch (c)
        {
        case '"':  out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\b': out += "\\b";  break;
        case '\f': out += "\\f";  break;
        case '\n': out += "\\n";  break;
        case '\r': out += "\\r";  break;
        case '\t': out += "\\t";  break;
        default:
            if (c < 0x20)
            {
                out += "\\u00";
                out += hex[(c >> 4) & 0xf];
                out += hex[c & 0xf];
            }
            else
            {
                out += static_cast<char>(c);
            }
            break;
        }
    }
    return out;
}
