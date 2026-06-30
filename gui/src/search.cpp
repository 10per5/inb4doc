#include "search.h"
#include "config.h"
#include "json.h"
#include <fstream>
#include <sstream>
#include <filesystem>
#include <cctype>

namespace fs = std::filesystem;

static std::string to_lower(const std::string &s)
{
    std::string out;
    out.reserve(s.size());
    for (unsigned char c : s)
        out.push_back(static_cast<char>(std::tolower(c)));
    return out;
}

static bool contains_ci(const std::string &text, const std::string &q)
{
    if (q.empty()) return false;
    for (size_t i = 0; i + q.size() <= text.size(); i++)
    {
        bool match = true;
        for (size_t j = 0; j < q.size(); j++)
        {
            if (std::tolower(static_cast<unsigned char>(text[i + j])) != q[j])
            { match = false; break; }
        }
        if (match) return true;
    }
    return false;
}

// Split content by blank lines (paragraphs)
static std::vector<std::string> split_paragraphs(const std::string &content)
{
    std::vector<std::string> out;
    size_t start = 0;
    while (start < content.size())
    {
        // Find blank line (two newlines with optional whitespace between)
        size_t end = content.size();
        for (size_t i = start; i + 1 < content.size(); i++)
        {
            if (content[i] == '\n')
            {
                size_t j = i + 1;
                while (j < content.size() && (content[j] == ' ' || content[j] == '\t'))
                    j++;
                if (j < content.size() && content[j] == '\n')
                {
                    end = i;
                    break;
                }
            }
        }

        std::string para;
        if (end == content.size())
        {
            para = content.substr(start);
            start = content.size();
        }
        else
        {
            para = content.substr(start, end - start);
            start = end + 1;
            while (start < content.size() && (content[start] == ' ' || content[start] == '\t' || content[start] == '\n'))
                start++;
        }

        if (!para.empty())
            out.push_back(para);
    }
    return out;
}

static std::string trim(const std::string &s)
{
    auto st = s.find_first_not_of(" \t\n\r");
    auto en = s.find_last_not_of(" \t\n\r");
    if (st == std::string::npos) return "";
    return s.substr(st, en - st + 1);
}

// Extract matching cells from a table paragraph
static std::vector<std::string> extract_table_cells(
    const std::string &paragraph, const std::string &q)
{
    std::vector<std::string> results;
    std::istringstream stream(paragraph);
    std::string line;
    int ri = 0;

    while (std::getline(stream, line))
    {
        auto lt = line.find_first_not_of(" \t");
        if (lt != std::string::npos) line = line.substr(lt);
        if (line.empty() || line[0] != '|') continue;
        if (line.find("---") != std::string::npos) continue;
        ri++;

        // Remove leading/trailing |
        if (!line.empty() && line[0] == '|') line = line.substr(1);
        if (!line.empty() && line.back() == '|') line.pop_back();

        // Split cells by |
        std::vector<std::string> cells;
        size_t p = 0;
        while (p < line.size())
        {
            auto next = line.find('|', p);
            std::string cell = (next == std::string::npos)
                ? line.substr(p)
                : line.substr(p, next - p);
            p = (next == std::string::npos) ? line.size() : next + 1;
            // trim cell
            auto cs = cell.find_first_not_of(" \t");
            auto ce = cell.find_last_not_of(" \t");
            if (cs != std::string::npos)
                cell = cell.substr(cs, ce - cs + 1);
            cells.push_back(cell);
        }

        for (int ci = 0; ci < static_cast<int>(cells.size()); ci++)
        {
            if (contains_ci(cells[ci], q))
            {
                results.push_back(cells[ci]);
                if (results.size() >= 3) return results;
            }
        }
    }
    return results;
}

// Extract matching snippets from full markdown content
static std::vector<std::string> extract_snippets(
    const std::string &content, const std::string &q, int max_snippets = 3)
{
    std::vector<std::string> snippets;
    auto paragraphs = split_paragraphs(content);

    for (const auto &para : paragraphs)
    {
        if (!contains_ci(para, q)) continue;

        auto trimmed = trim(para);
        if (trimmed.empty()) continue;

        if (trimmed[0] == '|')
        {
            auto cells = extract_table_cells(trimmed, q);
            for (const auto &c : cells)
            {
                snippets.push_back(c);
                if (snippets.size() >= static_cast<size_t>(max_snippets))
                    return snippets;
            }
        }
        else
        {
            snippets.push_back(trimmed);
            if (snippets.size() >= static_cast<size_t>(max_snippets))
                return snippets;
        }
    }
    return snippets;
}

// JSON-escape a string
static std::string json_escape(const std::string &s)
{
    std::string out;
    out.reserve(s.size() + 4);
    for (char c : s)
    {
        switch (c)
        {
        case '"':  out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n";  break;
        case '\r': out += "\\r";  break;
        case '\t': out += "\\t";  break;
        default:   out += c;      break;
        }
    }
    return out;
}

saucer::scheme::response handle_search(
    const config &cfg,
    std::string_view body)
{
    auto query = json_string_value(std::string(body), "query");

    if (query.empty())
        return {.data = saucer::stash::from_str("{\"results\":[]}"),
                .mime = "application/json", .status = 200};

    std::string q = to_lower(query);

    struct Result { std::string path; std::vector<std::string> snippets; };
    std::vector<Result> results;

    // Walk the content directory
    auto walk = [&](const fs::path &dir, const std::string &prefix, auto &self) -> void
    {
        if (!fs::exists(dir)) return;
        for (const auto &e : fs::directory_iterator(dir))
        {
            auto name = e.path().filename().string();
            auto rel = prefix.empty() ? name : prefix + "/" + name;
            if (name[0] == '.') continue;

            if (e.is_directory())
            {
                if (name == "image") continue;
                self(e.path(), rel, self);
            }
            else if (name.ends_with(".md"))
            {
                std::ifstream f(e.path());
                if (!f) continue;
                std::string content((std::istreambuf_iterator<char>(f)),
                                    std::istreambuf_iterator<char>());

                if (!contains_ci(content, q)) continue;

                auto result_path = rel;
                if (result_path.size() > 3 &&
                    result_path.substr(result_path.size() - 3) == ".md")
                    result_path = result_path.substr(0, result_path.size() - 3);

                auto snippets = extract_snippets(content, q);
                if (!snippets.empty())
                    results.push_back({result_path, snippets});
            }
        }
    };

    if (fs::exists(cfg.content_root))
        walk(cfg.content_root, "", walk);

    // Build JSON response
    std::ostringstream out;
    out << "{\"results\":[";
    bool first = true;
    for (const auto &r : results)
    {
        if (!first) out << ",";
        first = false;
        out << "{\"path\":\"" << json_escape(r.path)
            << "\",\"snippets\":[";
        bool sfirst = true;
        for (const auto &s : r.snippets)
        {
            if (!sfirst) out << ",";
            sfirst = false;
            out << "\"" << json_escape(s) << "\"";
        }
        out << "]}";
    }
    out << "]}\n";

    return {.data = saucer::stash::from_str(out.str()),
            .mime = "application/json", .status = 200};
}
