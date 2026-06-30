---
title: "Responsive Design"
weight: 10
---

# Responsive Design

The predoc editor adapts to different screen sizes while maintaining a consistent editing experience.

## Breakpoints

| Viewport | Width          | Behavior                           |
| -------- | -------------- | ---------------------------------- |
| Mobile   | < 768px        | Panels hidden, touch-optimized     |
| Tablet   | 768px – 1199px | Sidebar visible, meta-panel hidden |
| Desktop  | ≥ 1200px       | All panels visible                 |

## Panel Behavior

### Sidebar (Navigation)

* **Desktop/Tablet**: Always visible on the left (260px)

* **Mobile**: Hidden by default, accessible via hamburger menu (☰) in toolbar

  * Slides in from left with backdrop overlay

  * Tap backdrop or swipe to close

### Meta Panel (Frontmatter)

* **Desktop**: Always visible on the right (240px)

* **Tablet/Mobile**: Hidden by default, accessible via gear icon (⚙) in toolbar

  * Opens as slide-in panel on right

  * Backdrop overlay on tablet

## Editor Features

### Block Handles

* **Desktop**: Show on hover in left margin

* **Mobile**: Tap block to reveal handles

  * Larger touch targets (44×44px minimum)

  * Handles positioned closer to content

### Drag & Drop

* **Desktop**: Drag blocks using the handle

  * Drop indicator shows insertion point

* **Mobile**: Limited support

  * Tap-to-select block (future: long-press for drag)

  * Consider swipe gestures for reordering (future)

### Command Menu (/)

* **All viewports**: Triggered by typing `/` or via + button

* **Mobile**: Menu adapts to screen width

  * Larger touch targets for menu items

  * Positioned to avoid keyboard overlap

### @ Mentions

* **All viewports**: Triggered by typing `@`

* **Mobile**: Menu height limited to avoid keyboard

## CSS Architecture

Responsive styles use CSS custom properties:

```css
:root {
  --editor-padding-x: 1rem;        /* Mobile */
  --sidebar-width: 0;              /* Hidden */
  --aside-visibility: none;
}

@media (min-width: 768px) {
  :root {
    --editor-padding-x: 1.5rem;
    --sidebar-width: 260px;        /* Visible */
  }
}

@media (min-width: 1200px) {
  :root {
    --editor-padding-x: 2rem;
    --aside-visibility: flex;      /* Meta panel visible */
  }
}
```

Files:

* `editor/src/styles/global.css` — App layout

* `editor/src/styles/milkdown.css` — Editor components

* `editor/src/styles/responsive.css` — Breakpoints and transitions

## Touch Gestures (Future)

Planned gesture support for mobile:

| Gesture                   | Action                            |
| ------------------------- | --------------------------------- |
| Swipe from left edge      | Open sidebar                      |
| Swipe from right edge     | Open meta-panel                   |
| Long-press on block       | Select for drag                   |
| Swipe left/right on block | Quick actions (delete, duplicate) |

## Integration Guidelines

When adding new features:

1. **Mobile-first**: Design for mobile viewport first, enhance for larger screens
2. **Touch targets**: Minimum 44×44px for interactive elements
3. **Panel visibility**: Use CSS custom properties (`--sidebar-width`, etc.)
4. **Viewport detection**: Use `UIControllerAPI` from `ui_controller.ts`:

   ```ts
   const ui = this.ui; // injected via editor controller
   if (ui?.isMobile()) { /* mobile-specific behavior */ }
   ```
5. **Avoid hardcoded widths**: Use responsive variables for spacing and sizing
