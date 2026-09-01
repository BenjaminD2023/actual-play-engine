export const ACTION_CATALOG = [
  'qlab_cue',
  'show_preset',
  'stage_scene',
  'activate_scene',
  'advance_rundown',
  'go_back',
  'next_turn',
  'previous_turn',
  'focus_active_token',
  'camera_preset',
  'fog_region',
  'open_poll',
  'close_poll',
  'show_handout',
  'hide_handout',
  'recording_marker',
  'panic',
] as const;

export type RegisteredAction = (typeof ACTION_CATALOG)[number];

export function isRegisteredAction(value: string): value is RegisteredAction {
  return (ACTION_CATALOG as readonly string[]).includes(value);
}
