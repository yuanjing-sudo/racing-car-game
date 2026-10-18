class_name TDCEngineAudio
extends AudioStreamPlayer

## Engine, tyre and wind sound, synthesised from scratch. No audio files.
##
## Rather than shipping .wav assets that would have to be licensed, this fills an
## AudioStreamGenerator buffer with maths every frame:
##
##   * the engine, as a harmonic stack at the firing frequency implied by rpm,
##     so the pitch rises and falls with the tachometer from the car's gear model
##     and drops on every upshift;
##   * tyre scrub, as noise through a resonant peak, driven by the car's own
##     measured slip;
##   * wind roar, as noise with a speed-squared amplitude, which is how wind
##     noise physically scales.
##
## It is a deliberately simple model - an additive engine, not a sampled one - so
## it will not fool anyone into thinking it is a recorded V8. It does have the
## two properties that make engine audio read as real: the pitch tracks rpm, and
## it drops on the shift. Everything else is a texture on top.
##
## Godot note: get_stream_playback() can return null on the frame play() is
## called, because the audio server has not built the playback yet, so it is
## retried until it succeeds rather than being cached once.

@export_group("Source")

## The car to listen to.
@export var car: TDCPlayerCar

## Master volume of the whole synthesised mix, 0..1. Keep well below 1: the engine
## is a stacked sum and clips easily.
@export_range(0.0, 1.0, 0.01) var master_gain: float = 0.32

@export_group("Engine")

## Firing pulses per engine revolution. 2 for a four-stroke four-cylinder: 4
## cylinders each firing once every two revolutions.
@export var firing_pulses_per_revolution: float = 2.0

## Engine volume at idle, as a fraction of full. An engine is never silent.
@export_range(0.0, 1.0, 0.01) var idle_engine_level: float = 0.42

## Number of harmonics stacked above the firing frequency. More = brighter and
## raspier, fewer = a duller hum. 12 is a good raspy four-cylinder.
@export_range(1, 32, 1) var harmonics: int = 12

## How fast the harmonics fall away. 1.0 is a plain sawtooth, which is harsh;
## slightly under 1 is warmer.
@export_range(0.2, 1.5, 0.01) var harmonic_rolloff: float = 0.82

## Amount of combustion irregularity, 0..1. Adds the uneven, lumpy quality an
## ideal harmonic stack completely lacks.
@export_range(0.0, 1.0, 0.01) var combustion_noise: float = 0.22

@export_group("Tyres and wind")

## Volume of the tyre scrub at full slip.
@export_range(0.0, 1.0, 0.01) var tyre_gain: float = 0.30

## Centre frequency of the tyre scrub, in Hz. Tyre squeal lives around here.
@export var tyre_frequency: float = 1150.0

## How sharply the tyre noise is tuned. Higher = more of a squeal, lower = a
## broader roar.
@export var tyre_resonance: float = 7.0

## Volume of wind/road roar at top speed.
@export_range(0.0, 1.0, 0.01) var wind_gain: float = 0.16

@export_group("Mixing")

@export var mix_rate: float = 44100.0

## Audio buffer, in seconds. Larger = safer against frame hitches, more latency.
@export_range(0.02, 0.5, 0.01) var buffer_length: float = 0.10

var _playback: AudioStreamGeneratorPlayback
var _phase: float = 0.0
var _tyre_phase: float = 0.0
var _tyre_state_a: float = 0.0
var _tyre_state_b: float = 0.0
var _wind_state: float = 0.0
var _noise_state: float = 0.0
var _level_smoother: float = 0.0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_rng.randomize()

	var generator := AudioStreamGenerator.new()
	generator.mix_rate = mix_rate
	generator.buffer_length = buffer_length
	stream = generator

	# A synthesised engine is not a positioned sound source in this project: the
	# chase camera hears it from one place, so a non-positional player is right
	# and avoids the engine fading out as the car pulls away from the camera.
	volume_db = linear_to_db(clampf(master_gain, 0.0001, 1.0))

	play()


func _process(_delta: float) -> void:
	if _playback == null:
		_playback = get_stream_playback() as AudioStreamGeneratorPlayback
		if _playback == null:
			return

	var frames := _playback.get_frames_available()
	if frames <= 0:
		return

	var samples := PackedVector2Array()
	samples.resize(frames)

	for i in range(frames):
		var value := _next_sample()
		samples[i] = Vector2(value, value)

	_playback.push_buffer(samples)


func _next_sample() -> float:
	var rpm := 900.0
	var load := 0.0
	var slip := 0.0
	var speed_01 := 0.0

	if car != null:
		rpm = car.engine_rpm
		load = clampf(car.throttle_input, 0.0, 1.0)
		slip = car.tyre_slip_01
		speed_01 = car.speed_01

	# Even off the throttle the engine is turning, so a floor is added from rpm:
	# that is what a driver hears as engine braking rather than silence.
	load = maxf(load, clampf((rpm - 1200.0) / 6400.0, 0.0, 1.0) * 0.55)

	# ---- Engine ------------------------------------------------------------
	var firing_hz := rpm / 60.0 * firing_pulses_per_revolution
	var engine := 0.0

	if firing_hz > 0.0:
		var fundamental := TAU * firing_hz / mix_rate
		for h in range(1, harmonics + 1):
			var amplitude := pow(float(h), -harmonic_rolloff)
			engine += sin(_phase * float(h)) * amplitude
		_phase = fposmod(_phase + fundamental, TAU)

		# Normalise the harmonic sum back to roughly -1..1.
		engine *= 0.55 / maxf(1.0, float(harmonics) * 0.42)

	# Combustion irregularity: a fast, noisy wobble on the amplitude, which is
	# what separates an engine from a synthesiser.
	if combustion_noise > 0.0:
		_noise_state = _noise_state * 0.72 + _rng.randf_range(-1.0, 1.0) * 0.28
		engine *= 1.0 + combustion_noise * _noise_state

	var engine_level := idle_engine_level + (1.0 - idle_engine_level) * load
	engine *= engine_level

	# ---- Tyres -------------------------------------------------------------
	# Two cascaded one-pole filters with feedback around them, which resonates at
	# roughly tyre_frequency. A simple and cheap way to get a squeal out of noise.
	var tyre := 0.0
	if slip > 0.01:
		var white := _rng.randf_range(-1.0, 1.0)
		var cutoff := clampf(tyre_frequency / mix_rate * TAU, 0.0, 1.0)
		_tyre_state_a += cutoff * (white - _tyre_state_a)
		_tyre_state_b += cutoff * (_tyre_state_a - _tyre_state_b)
		tyre = (_tyre_state_b - _tyre_state_a) * tyre_resonance

		# A slow wobble, so a long drift does not sound like a held sine.
		_tyre_phase = fposmod(_tyre_phase + 0.0004, TAU)
		tyre *= 0.75 + 0.25 * sin(_tyre_phase)
		tyre *= slip * tyre_gain

	# ---- Wind --------------------------------------------------------------
	var wind := 0.0
	if speed_01 > 0.02:
		var white_wind := _rng.randf_range(-1.0, 1.0)
		_wind_state += 0.06 * (white_wind - _wind_state)
		wind = _wind_state * speed_01 * speed_01 * wind_gain * 3.0

	# ---- Mix ---------------------------------------------------------------
	var mix := engine + tyre + wind

	# One-pole smoothing removes the harshest digital edges from the noise terms
	# and stops the mix twitching between frames.
	_level_smoother += 0.35 * (mix - _level_smoother)

	# Soft clip rather than hard: a limiter that rounds instead of tearing.
	return tanh(_level_smoother * 1.15) * 0.9
