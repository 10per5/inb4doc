local qt_libs     = { "Qt6Widgets", "Qt6WebChannel", "Qt6WebEngineWidgets", "Qt6Gui", "Qt6Core", "Qt6WebEngineCore" }
local include_libs = { "saucer", "coco", "ereignis", "rebind", "glaze" }

workspace("predoc-gui")
configurations({ "redist" })
architecture("x86_64")

project("predoc-gui")
kind("ConsoleApp")
language("C++")
cppdialect("C++23")
targetdir("bin")
files({ "src/**.cpp" })

filter("system:linux")
includedirs({ "vendor" })
for _, lib in ipairs(include_libs) do
	includedirs({ "/usr/local/include/" .. lib })
end
libdirs({ "/usr/local/lib" })

filter({ "system:linux", "configurations:redist" })
	buildoptions({ "-mno-direct-extern-access" })
	links({ "saucer", "coco" })
	links(qt_libs)
	linkoptions({ "-Wl,-rpath,/usr/lib/x86_64-linux-gnu" })