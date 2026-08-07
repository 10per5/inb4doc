#include "platform.h"
#include <cstdlib>
#include <filesystem>
#ifdef _WIN32
#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#else
#include <unistd.h>
#endif
#if defined(__linux__)
#include <QFileDialog>
#include <QDir>
#endif
#if defined(__APPLE__)
#include <objc/runtime.h>
#include <objc/message.h>
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

    auto candidate = (dir / "editor").lexically_normal();
    if (fs::exists(candidate) && fs::is_directory(candidate))
        return candidate.string();

#ifdef _WIN32
    return "C:/Program Files/inb4doc/editor";
#else
    return "/opt/inb4doc/editor";
#endif
}

std::string default_data_dir()
{
#ifdef _WIN32
    wchar_t *raw = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &raw)))
    {
        auto dir = fs::path(raw) / "inb4doc";
        CoTaskMemFree(raw);
        return dir.string();
    }
    CoTaskMemFree(raw);
    return {};
#elif defined(__APPLE__)
    auto home = std::getenv("HOME");
    return home ? (fs::path(home) / "Library" / "Application Support" / "inb4doc").string() : std::string{};
#else
    auto xdg = std::getenv("XDG_DATA_HOME");
    if (xdg)
        return (fs::path(xdg) / "inb4doc").string();
    auto home = std::getenv("HOME");
    return home ? (fs::path(home) / ".local" / "share" / "inb4doc").string() : std::string{};
#endif
}

std::string default_editor_data_dir()
{
    auto base = default_data_dir();
    return base.empty() ? std::string{} : (fs::path(base) / "JsStaticFs").string();
}

std::string default_browser_data_dir()
{
    auto base = default_data_dir();
    return base.empty() ? std::string{} : (fs::path(base) / "Browser").string();
}

std::string pick_directory(const std::string &initial_dir)
{
#if defined(__linux__)
    auto start = initial_dir.empty() ? QDir::homePath()
                                     : QString::fromStdString(initial_dir);
    auto dir = QFileDialog::getExistingDirectory(
        nullptr, QStringLiteral("Open Project"), start,
        QFileDialog::ShowDirsOnly | QFileDialog::DontResolveSymlinks);
    if (dir.isEmpty())
        return {};
    return dir.toStdString();
#elif defined(_WIN32)
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)))
        return {};
    std::string result;
    IFileDialog *pfd = nullptr;
    HRESULT hr = CoCreateInstance(CLSID_FileOpenDialog, nullptr,
                                  CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&pfd));
    if (SUCCEEDED(hr))
    {
        DWORD opts = 0;
        pfd->GetOptions(&opts);
        pfd->SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
        hr = pfd->Show(nullptr);
        if (SUCCEEDED(hr))
        {
            IShellItem *item = nullptr;
            if (SUCCEEDED(pfd->GetResult(&item)) && item)
            {
                PWSTR path = nullptr;
                if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) && path)
                {
                    int len = WideCharToMultiByte(CP_UTF8, 0, path, -1,
                                                  nullptr, 0, nullptr, nullptr);
                    if (len > 0)
                    {
                        result.resize(static_cast<std::size_t>(len - 1));
                        WideCharToMultiByte(CP_UTF8, 0, path, -1, result.data(),
                                            len, nullptr, nullptr);
                    }
                    CoTaskMemFree(path);
                }
                item->Release();
            }
        }
        pfd->Release();
    }
    CoUninitialize();
    return result;
#elif defined(__APPLE__)
    auto send = reinterpret_cast<id (*)(id, SEL, ...)>(&objc_msgSend);
    id panel = send(objc_getClass("NSOpenPanel"), sel_getUid("openPanel"));
    send(panel, sel_getUid("setCanChooseDirectories:"), true);
    send(panel, sel_getUid("setCanChooseFiles:"), false);
    send(panel, sel_getUid("setAllowsMultipleSelection:"), false);
    id resp = send(panel, sel_getUid("runModal"));
    if (reinterpret_cast<long>(resp) != 1) // NSModalResponseOK
        return {};
    id url = send(panel, sel_getUid("URL"));
    if (!url)
        return {};
    id path = send(url, sel_getUid("path"));
    auto c = reinterpret_cast<const char *>(send(path, sel_getUid("UTF8String")));
    return c ? std::string(c) : std::string{};
#else
    (void)initial_dir;
    return {};
#endif
}
