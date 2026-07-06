#include "mac_shortcuts.h"
#include <saucer/webview.hpp>
#include <saucer/modules/stable/webkit.hpp>

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

void setup_mac_shortcuts(saucer::application *app, saucer::webview *wv)
{
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
        handler:^NSEvent *(NSEvent *event)
    {
        if ([event modifierFlags] & NSEventModifierFlagCommand)
        {
            NSString *chars = [event charactersIgnoringModifiers];
            if ([chars isEqualToString:@"q"])
            {
                app->quit();
                return nil;
            }
            if ([chars isEqualToString:@"f"])
            {
                auto *wk = static_cast<WKWebView *>(wv->native<true>().webview);
                [wk evaluateJavaScript:@"window.predocUI?.openFind?.()"
                     completionHandler:nil];
                return nil;
            }
        }
        if ([event keyCode] == 0x63) // kVK_F3
        {
            auto *wk = static_cast<WKWebView *>(wv->native<true>().webview);
            if ([event modifierFlags] & NSEventModifierFlagShift)
                [wk evaluateJavaScript:@"window.predocUI?.findPrev?.()"
                     completionHandler:nil];
            else
                [wk evaluateJavaScript:@"window.predocUI?.findNext?.()"
                     completionHandler:nil];
            return nil;
        }
        return event;
    }];
}
