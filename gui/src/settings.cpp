#include "settings.h"
#include <filesystem>
#include <fstream>
#include <string>

namespace
{
    std::string trim(const std::string &s)
    {
        std::string out = s;
        out.erase(0, out.find_first_not_of(" \t"));
        out.erase(out.find_last_not_of(" \t") + 1);
        return out;
    }
}

settings settings::load(const std::string &data_dir)
{
    settings out;
    if (data_dir.empty())
        return out;

    std::ifstream ifs(std::filesystem::path(data_dir) / "inb4.config.toml");
    if (!ifs)
        return out;

    std::string line;
    while (std::getline(ifs, line))
    {
        auto eq = line.find('=');
        if (eq == std::string::npos)
            continue;
        auto key = trim(line.substr(0, eq));
        auto val = trim(line.substr(eq + 1));
        if (key == "zoom")
        {
            try
            {
                out.zoom = std::stof(val);
            }
            catch (...) {}
        }
        else if (key == "content_root")
        {
            out.content_root = val;
        }
    }
    return out;
}

void settings::save(const std::string &data_dir) const
{
    if (data_dir.empty())
        return;
    std::filesystem::create_directories(data_dir);
    std::ofstream ofs(std::filesystem::path(data_dir) / "inb4.config.toml",
                      std::ios::trunc);
    if (!ofs)
        return;
    ofs << "zoom = " << zoom << "\n";
    if (!content_root.empty())
        ofs << "content_root = " << content_root << "\n";
}
