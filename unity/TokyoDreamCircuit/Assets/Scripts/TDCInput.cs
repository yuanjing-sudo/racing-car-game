using UnityEngine;

#if ENABLE_INPUT_SYSTEM && !ENABLE_LEGACY_INPUT_MANAGER
using UnityEngine.InputSystem;
#endif

/// <summary>
/// Reads the driving controls without caring which input backend the project uses.
///
/// This exists for a specific reason. Unity 6.3's default template ships the new
/// Input System and sets Active Input Handling to "Input System" only, and in
/// that configuration every legacy call - Input.GetAxis, Input.GetKey - throws
/// <c>InvalidOperationException</c>. Older projects are the other way round.
/// Rather than make you change a project setting, both paths are compiled and
/// the right one is selected by the predefined symbols Unity sets for you:
///
///   ENABLE_INPUT_SYSTEM          the new Input System is installed and active
///   ENABLE_LEGACY_INPUT_MANAGER  the old Input Manager is active
///
/// Both set ("Both" in Player Settings) prefers the legacy path, which is
/// deliberate - it also happens to give gamepad and arrow-key support for free
/// through the default Horizontal/Vertical axes.
///
/// Bindings, matching the Unreal project:
///   throttle    W / S  or  Up / Down, plus gamepad stick and right trigger
///   steer       A / D  or  Left / Right, plus gamepad left stick X
///   brake       Space, plus gamepad left trigger
///   handbrake   Left Shift, plus gamepad south button
///   reset       R
/// </summary>
public static class TDCInput
{
    /// <summary>-1 reverse to +1 forward.</summary>
    public static float Throttle
    {
        get
        {
#if ENABLE_INPUT_SYSTEM && !ENABLE_LEGACY_INPUT_MANAGER
            float value = 0f;

            Keyboard keyboard = Keyboard.current;
            if (keyboard != null)
            {
                if (keyboard.wKey.isPressed || keyboard.upArrowKey.isPressed) value += 1f;
                if (keyboard.sKey.isPressed || keyboard.downArrowKey.isPressed) value -= 1f;
            }

            Gamepad pad = Gamepad.current;
            if (pad != null)
            {
                value += pad.leftStick.y.ReadValue();
                value += pad.rightTrigger.ReadValue();
            }

            return Mathf.Clamp(value, -1f, 1f);
#else
            return Input.GetAxisRaw("Vertical");
#endif
        }
    }

    /// <summary>-1 left to +1 right.</summary>
    public static float Steer
    {
        get
        {
#if ENABLE_INPUT_SYSTEM && !ENABLE_LEGACY_INPUT_MANAGER
            float value = 0f;

            Keyboard keyboard = Keyboard.current;
            if (keyboard != null)
            {
                if (keyboard.aKey.isPressed || keyboard.leftArrowKey.isPressed) value -= 1f;
                if (keyboard.dKey.isPressed || keyboard.rightArrowKey.isPressed) value += 1f;
            }

            Gamepad pad = Gamepad.current;
            if (pad != null)
            {
                value += pad.leftStick.x.ReadValue();
            }

            return Mathf.Clamp(value, -1f, 1f);
#else
            return Input.GetAxisRaw("Horizontal");
#endif
        }
    }

    /// <summary>0 to 1. Analog on a gamepad, all-or-nothing on the keyboard.</summary>
    public static float Brake
    {
        get
        {
#if ENABLE_INPUT_SYSTEM && !ENABLE_LEGACY_INPUT_MANAGER
            float value = 0f;

            Keyboard keyboard = Keyboard.current;
            if (keyboard != null && keyboard.spaceKey.isPressed) value = 1f;

            Gamepad pad = Gamepad.current;
            if (pad != null) value = Mathf.Max(value, pad.leftTrigger.ReadValue());

            return Mathf.Clamp01(value);
#else
            return Input.GetKey(KeyCode.Space) ? 1f : 0f;
#endif
        }
    }

    public static bool Handbrake
    {
        get
        {
#if ENABLE_INPUT_SYSTEM && !ENABLE_LEGACY_INPUT_MANAGER
            Keyboard keyboard = Keyboard.current;
            if (keyboard != null && keyboard.leftShiftKey.isPressed) return true;

            Gamepad pad = Gamepad.current;
            return pad != null && pad.buttonSouth.isPressed;
#else
            return Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
#endif
        }
    }

    public static bool ResetPressed
    {
        get
        {
#if ENABLE_INPUT_SYSTEM && !ENABLE_LEGACY_INPUT_MANAGER
            Keyboard keyboard = Keyboard.current;
            return keyboard != null && keyboard.rKey.wasPressedThisFrame;
#else
            return Input.GetKeyDown(KeyCode.R);
#endif
        }
    }
}
