/** Events for the hand-off between the window frame the manager renders and the
 * body controller mounted inside it (the two are separate Stimulus scopes). */
export const WindowEvent = {
  /**
   * Dispatched by the manager on the **body element** when the frame's Accept
   * button is pressed. The body declares the action
   * (`data-action="window:accept-request-><id>#accept"`, set by the manager) so
   * each window decides what "accept" means — Accept has no frame-level meaning
   * of its own.
   */
  AcceptRequest: "window:accept-request",

  /**
   * Dispatched by a body to enable/disable the frame's Accept button.
   * Detail: `{ enabled: boolean }`. Used instead of reaching into the frame
   * markup from the body controller.
   */
  SetAcceptEnabled: "window:set-accept-enabled",
} as const
