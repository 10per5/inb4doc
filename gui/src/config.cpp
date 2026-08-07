#include "config.h"

std::string config::root() const
{
    if (root_state)
        return root_state->get();
    return {};
}
