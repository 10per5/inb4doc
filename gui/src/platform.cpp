#include "platform.h"
#include <cstdlib>
#include <filesystem>
#ifdef _WIN32
#include <windows.h>
#include <shlobj.h>
#else
#include <unistd.h>
#endif
namespace fs = std::filesystem;

std::string exe_path()
{
    char buf[4096];
#ifdef _WIN32
    GetModuleFileNameA(nullptr, buf, sizeof(buf));
    return buf;
#elif __APPLE__
    uint32_t size = sizeof(buf);
    if (_NSGetExecutablePath(buf, &size) == 0)
        return buf;
    return {};
#else
    ssize_t len = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
    if (len > 0)
    {
        buf[len] = '\0';
        return buf;
    }
    return {};
#endif
}

std::string default_editor_root()
{
    auto dir = fs::path(exe_path()).parent_path();

    for (const auto &candidate : {dir / ".." / "editor", dir / "editor"})
    {
        auto norm = candidate.lexically_normal();
        if (fs::exists(norm) && fs::is_directory(norm))
            return norm.string();
    }

#ifdef _WIN32
    return "C:/Program Files/predoc/editor";
#else
    return "/opt/predoc/editor";
#endif
}

std::string default_data_dir()
{
#ifdef _WIN32
    wchar_t *raw = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &raw)))
    {
        auto dir = fs::path(raw) / "predoc";
        CoTaskMemFree(raw);
        return dir.string();
    }
    CoTaskMemFree(raw);
    return {};
#elif defined(__APPLE__)
    auto home = std::getenv("HOME");
    return home ? (fs::path(home) / "Library" / "Application Support" / "predoc").string() : std::string{};
#else
    auto xdg = std::getenv("XDG_DATA_HOME");
    if (xdg)
        return (fs::path(xdg) / "predoc").string();
    auto home = std::getenv("HOME");
    return home ? (fs::path(home) / ".local" / "share" / "predoc").string() : std::string{};
#endif
}
