#include "TDCEngineAudioComponent.h"

#include "TDCPlayerCar.h"
#include "GameFramework/Actor.h"

UTDCEngineAudioComponent::UTDCEngineAudioComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickGroup = TG_PostPhysics;

	// Mono out, upmixed by Unreal's mixer. See the class comment on why.
	NumChannels = 1;

	// The chase camera hears the engine from one place, so this is not a
	// positioned sound: making it spatial would fade the engine out as the car
	// pulls away from the camera, which is not what a driver hears.
	bAllowSpatialization = false;

	// Deliberately not touching VolumeMultiplier. Gain is applied inside the
	// synthesis, so there is one place where the level is set.
	Noise.Initialize(1337);
}

void UTDCEngineAudioComponent::BeginPlay()
{
	Super::BeginPlay();

	Car = Cast<ATDCPlayerCar>(GetOwner());
	if (!Car.IsValid())
	{
		UE_LOG(LogTemp, Warning,
			TEXT("UTDCEngineAudioComponent: owner is not an ATDCPlayerCar, so the engine will idle."));
	}

	// A synth component does not generate until it is started.
	Start();
}

void UTDCEngineAudioComponent::SampleTelemetry()
{
	const ATDCPlayerCar* Target = Car.Get();
	if (!Target)
	{
		// Nothing to listen to, so fall back to idle. The engine still runs rather
		// than going silent, which is what an engine does.
		CachedRpm = 900.0f;
		CachedThrottle = 0.0f;
		CachedSlip = 0.0f;
		CachedSpeed01 = 0.0f;
		return;
	}

	CachedRpm = Target->GetEngineRpm();
	CachedThrottle = FMath::Clamp(Target->GetThrottleInput(), 0.0f, 1.0f);
	CachedSlip = Target->GetTyreSlip01();
	CachedSpeed01 = Target->GetSpeed01();
}

void UTDCEngineAudioComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	SampleTelemetry();
}

bool UTDCEngineAudioComponent::Init(int32& SampleRate)
{
	NumChannels = 1;
	SampleRate = FMath::Clamp(SampleRate, 8000, 48000);
	CachedSampleRate = SampleRate;
	return true;
}

int32 UTDCEngineAudioComponent::OnGenerateAudio(float* OutAudio, int32 NumSamples)
{
	if (!OutAudio || NumSamples <= 0)
	{
		return 0;
	}

	// The rate Init was given for this device. Read here rather than assumed, so a
	// 44.1 kHz device does not get an engine pitched up by 8%.
	const int32 SampleRate = FMath::Max(8000, CachedSampleRate);

	for (int32 i = 0; i < NumSamples; ++i)
	{
		OutAudio[i] = NextSample(SampleRate);
	}

	return NumSamples;
}

float UTDCEngineAudioComponent::NextSample(int32 SampleRate)
{
	// ---- Load --------------------------------------------------------------
	// Even off the throttle the engine is turning, so a floor is added from rpm:
	// that is what a driver hears as engine braking, not silence.
	float Load = CachedThrottle;
	Load = FMath::Max(Load, FMath::Clamp((CachedRpm - 1200.0f) / 6400.0f, 0.0f, 1.0f) * 0.55f);

	// ---- Engine ------------------------------------------------------------
	const float FiringHz = CachedRpm / 60.0f * FiringPulsesPerRevolution;
	float Engine = 0.0f;

	if (FiringHz > 0.0f)
	{
		const double Increment = 2.0 * PI * FiringHz / static_cast<double>(SampleRate);
		const int32 HarmonicCount = FMath::Clamp(Harmonics, 1, 32);

		for (int32 H = 1; H <= HarmonicCount; ++H)
		{
			Engine += static_cast<float>(FMath::Sin(EnginePhase * static_cast<double>(H)))
				* FMath::Pow(static_cast<float>(H), -HarmonicRolloff);
		}

		EnginePhase += Increment;
		if (EnginePhase > 2.0 * PI)
		{
			EnginePhase -= 2.0 * PI;
		}

		// Normalise the harmonic sum back to roughly -1..1.
		Engine *= 0.55f / FMath::Max(1.0f, HarmonicCount * 0.42f);
	}

	// Combustion irregularity: a fast, noisy wobble on the amplitude, which is
	// what separates an engine from a synthesiser.
	if (CombustionNoise > 0.0f)
	{
		const float White = Noise.FRandRange(-1.0f, 1.0f);
		CombustionState = CombustionState * 0.72f + White * 0.28f;
		Engine *= 1.0f + CombustionNoise * CombustionState;
	}

	Engine *= IdleEngineLevel + (1.0f - IdleEngineLevel) * Load;

	// ---- Tyres -------------------------------------------------------------
	// Two cascaded one-pole filters with feedback around them, which resonates at
	// roughly TyreFrequency. A cheap way to get a squeal out of noise.
	float Tyre = 0.0f;
	if (CachedSlip > 0.01f)
	{
		const float White = Noise.FRandRange(-1.0f, 1.0f);
		const float Cutoff = FMath::Clamp(TyreFrequency / SampleRate * 2.0f * PI, 0.0f, 1.0f);

		TyreStateA += Cutoff * (White - TyreStateA);
		TyreStateB += Cutoff * (TyreStateA - TyreStateB);
		Tyre = (TyreStateB - TyreStateA) * TyreResonance;

		// A slow wobble, so a long drift does not sound like a held sine.
		TyrePhase += 0.0004;
		if (TyrePhase > 2.0 * PI)
		{
			TyrePhase -= 2.0 * PI;
		}
		Tyre *= 0.75f + 0.25f * static_cast<float>(FMath::Sin(TyrePhase));

		Tyre *= CachedSlip * TyreGain;
	}

	// ---- Wind --------------------------------------------------------------
	float Wind = 0.0f;
	if (CachedSpeed01 > 0.02f)
	{
		const float White = Noise.FRandRange(-1.0f, 1.0f);
		WindState += 0.06f * (White - WindState);
		Wind = WindState * CachedSpeed01 * CachedSpeed01 * WindGain * 3.0f;
	}

	// ---- Mix ---------------------------------------------------------------
	const float Mix = Engine + Tyre + Wind;

	// One-pole smoothing removes the harshest digital edges from the noise terms
	// and stops the mix twitching between frames.
	LevelSmoother += 0.35f * (Mix - LevelSmoother);

	// Soft clip rather than hard: a limiter that rounds instead of tearing.
	return FMath::Tanh(LevelSmoother * 1.15f) * 0.9f * MasterGain;
}
