#pragma once
#include "config.h"
#include <string>
#include <vector>
#include <saucer/scheme.hpp>

saucer::scheme::response handle_search(
    const config &cfg,
    std::string_view body);
