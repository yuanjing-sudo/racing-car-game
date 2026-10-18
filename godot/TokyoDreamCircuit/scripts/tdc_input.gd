class_name TDCInput
extends RefCounted

## Reads the driving controls.
##
## Bindings, matching the Unreal and Unity versions:
##   throttle    W / S  or  Up / Down, plus gamepad stick and right trigger
##   steer       A / D  or  Left / Right, plus gamepad left stick X
##   brake       Space, plus gamepad left trigger
##   handbrake   Shift, plus gamepad south button
##   reset       R
##
## Why this reads keys directly instead of using an InputMap: the built-in
## ui_up / ui_down / ui_left / ui_right actions already exist in every new Godot
## project and are already bound to the arrow keys, the D-pad and the left stick,
## so they give gamepad support for free. Defining custom actions would mean
## serialising InputEventKey objects into project.godot, whose property list has
## changed between 4.x releases - a whole class of breakage for no benefit. Add
## your own InputMap actions later if you want remappable controls; the call
## sites here are one line each.

const DEADZONE := 0.12

static var _reset_was_down := false


## -1 reverse to +1 forward.
static func throttle() -> float:
	var value := 0.0

	if Input.is_physical_key_pressed(KEY_W) or Input.is_action_pressed("ui_up"):
		value += 1.0
	if Input.is_physical_key_pressed(KEY_S) or Input.is_action_pressed("ui_down"):
		value -= 1.0

	# The gamepad left stick also drives ui_up / ui_down, so only the trigger
	# needs reading here.
	value += Input.get_joy_axis(0, JOY_AXIS_TRIGGER_RIGHT)

	return clampf(value, -1.0, 1.0)


## -1 left to +1 right.
static func steer() -> float:
	var value := 0.0

	if Input.is_physical_key_pressed(KEY_A) or Input.is_action_pressed("ui_left"):
		value -= 1.0
	if Input.is_physical_key_pressed(KEY_D) or Input.is_action_pressed("ui_right"):
		value += 1.0

	var stick := Input.get_joy_axis(0, JOY_AXIS_LEFT_X)
	if absf(stick) > DEADZONE:
		value += stick

	return clampf(value, -1.0, 1.0)


## 0 to 1. Analog on a gamepad, all-or-nothing on the keyboard.
static func brake() -> float:
	var value := 0.0

	if Input.is_key_pressed(KEY_SPACE):
		value = 1.0

	value = maxf(value, Input.get_joy_axis(0, JOY_AXIS_TRIGGER_LEFT))

	return clampf(value, 0.0, 1.0)


static func handbrake() -> bool:
	return Input.is_key_pressed(KEY_SHIFT) or Input.is_joy_button_pressed(0, JOY_BUTTON_A)


## True only on the frame R goes down, so holding it does not reset every tick.
static func reset_pressed() -> bool:
	var down := Input.is_physical_key_pressed(KEY_R)
	if down and not _reset_was_down:
		_reset_was_down = true
		return true
	if not down:
		_reset_was_down = false
	return false
