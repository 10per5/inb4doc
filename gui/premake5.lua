local qt_libs = { "Qt6Widgets", "Qt6WebChannel", "Qt6WebEngineWidgets", "Qt6Gui", "Qt6Core", "Qt6WebEngineCore" }
local saucer_dir = os.getenv("SAUCER_DIR") or "vendor/saucer"

workspace("predoc-gui")
configurations({ "debug", "release" })
architecture("x86_64")

project("predoc-gui")
kind("ConsoleApp")
language("C++")
cppdialect("C++23")
targetdir("bin")
files({ "src/**.cpp" })

filter("system:linux")
includedirs({ "vendor" })
includedirs({ saucer_dir .. "/include" })
local qt_inc = os.outputof("pkg-config --cflags-only-I Qt6Core Qt6Gui Qt6Widgets Qt6WebEngineCore Qt6WebEngineWidgets 2>/dev/null")
if qt_inc and qt_inc ~= "" then
	for dir in qt_inc:gmatch("%-I([^%s]+)") do
		includedirs({ dir })
	end
end
libdirs({ saucer_dir .. "/lib" })

filter("system:macosx")
files({ "src/**.mm", "src/**.h" })

filter("system:windows")
includedirs({ "vendor" })
includedirs({ saucer_dir .. "/include" })
libdirs({ saucer_dir .. "/lib" })

filter({ "system:windows", "configurations:release" })
kind("WindowedApp")
links({ "saucer", "coco", "WebView2LoaderStatic" })
links({ "Wininet", "gdiplus", "Shlwapi", "Comctl32", "CoreMessaging", "RuntimeObject", "Bcrypt" })
linkoptions({ "/ENTRY:mainCRTStartup" })

filter("configurations:debug")
symbols("On")
optimize("Off")

filter("configurations:release")
symbols("Off")
optimize("Speed")

filter({ "system:linux", "configurations:release" })
buildoptions({ "-mno-direct-extern-access" })
links({ "saucer", "coco" })
links(qt_libs)
linkoptions({ "-Wl,-rpath,/usr/lib/x86_64-linux-gnu" })

filter({ "system:linux", "configurations:debug" })
buildoptions({ "-mno-direct-extern-access" })
links({ "saucer", "coco" })
links(qt_libs)
linkoptions({ "-Wl,-rpath,/usr/lib/x86_64-linux-gnu" })
