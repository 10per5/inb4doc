#include "gitignore.h"
#include <fstream>
#include <algorithm>

namespace fs = std::filesystem;

std::vector<GitIgnorePattern> load_gitignore(const fs::path &dir)
{
    std::vector<GitIgnorePattern> out;
    auto gi_path = dir / ".gitignore";
    std::ifstream f(gi_path);
    if (!f)
        return out;

    std::string line;
    while (std::getline(f, line))
    {
        while (!line.empty() && (line.back() == ' ' || line.back() == '\t'))
            line.pop_back();
        if (line.empty() || line[0] == '#')
            continue;

        GitIgnorePattern p;

        if (line[0] == '!')
        {
            p.negate = true;
            line = line.substr(1);
        }

        if (!line.empty() && line.back() == '/')
        {
            p.dir_only = true;
            line.pop_back();
        }

        if (line.empty())
            continue;

        p.pattern = line;
        p.anchored = line.find('/') != std::string::npos;
        out.push_back(p);
    }
    return out;
}

bool glob_match(const std::string &pat, std::size_t pi,
                const std::string &str, std::size_t si)
{
    for (;;)
    {
        if (pi == pat.size() && si == str.size())
            return true;

        if (pi + 1 < pat.size() && pat[pi] == '*' && pat[pi + 1] == '*')
        {
            pi += 2;
            if (pi == pat.size())
                return true;
            for (auto i = si; i <= str.size(); ++i)
                if (glob_match(pat, pi, str, i))
                    return true;
            return false;
        }

        if (pi < pat.size() && pat[pi] == '*')
        {
            ++pi;
            for (auto i = si; i <= str.size(); ++i)
            {
                if (i > si && str[i - 1] == '/')
                    break;
                if (glob_match(pat, pi, str, i))
                    return true;
            }
            return false;
        }

        if (pi < pat.size() && pat[pi] == '?')
        {
            if (si >= str.size() || str[si] == '/')
                return false;
            ++pi;
            ++si;
            continue;
        }

        if (pi < pat.size() && si < str.size() && pat[pi] == str[si])
        {
            ++pi;
            ++si;
            continue;
        }

        return false;
    }
}

bool is_ignored(const std::string &name, bool is_dir,
                const std::vector<GitIgnorePattern> &patterns)
{
    bool ignored = false;
    for (const auto &p : patterns)
    {
        if (p.dir_only && !is_dir)
            continue;

        bool matched = false;

        if (p.anchored)
        {
            matched = glob_match(p.pattern, 0, name, 0);
        }
        else
        {
            auto slash = name.rfind('/');
            auto base  = (slash == std::string::npos) ? name : name.substr(slash + 1);
            matched = glob_match(p.pattern, 0, base, 0);
        }

        if (matched)
            ignored = !p.negate;
    }
    return ignored;
}
