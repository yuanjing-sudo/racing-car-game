#include "TDCRainAudioComponent.h"

UTDCRainAudioComponent::UTDCRainAudioComponent()
{
	// Mono out, upmixed by the mixer. Same choice as the engine audio.
	NumChannels = 1;

	// Rain surrounds the car, so making it spatial would swing it around the
	// camera as the car rotates. It is a bed, not a point source.
	bAllowSpatialization = false;

	Noise.Initialize(90210);
}

void UTDCRainAudioComponent::BeginPlay()
{
	Super::BeginPlay();

	// A synth does not generate until started.
	Start();
}

bool UTDCRainAudioComponent::Init(int32& SampleRate)
{
	NumChannels = 1;
	SampleRate = FMath::Clamp(SampleRate, 8000, 48000);
	CachedSampleRate = SampleRate;

	const float Rate = static_cast<float>(SampleRate);

	// One-pole coefficients, derived once per device rate.
	LowCoeff = 1.0f - FMath::Exp(-2.0f * PI * BodyCutoffHz / Rate);
	HighCoeff = 1.0f / (1.0f + 2.0f * PI * HissCutoffHz / Rate);
	GainCoeff = 1.0f - FMath::Exp(-1.0f / (FMath::Max(0.01f, SmoothingSeconds) * Rate));

	return true;
}

float UTDCRainAudioComponent::NextSample()
{
	const float White = Noise.FRandRange(-1.0f, 1.0f);

	// Body: low-passed noise.
	LowState += (White - LowState) * LowCoeff;

	// Hiss: one-pole high-pass of the same source.
	HighState = HighCoeff * (HighState + White - HighPrevious);
	HighPrevious = White;

	const float Mixed = LowState * (1.0f - CurrentHiss) + HighState * CurrentHiss;
	return Mixed;
}

int32 UTDCRainAudioComponent::OnGenerateAudio(float* OutAudio, int32 NumSamples)
{
	if (!OutAudio || NumSamples <= 0)
	{
		return 0;
	}

	// Read the targets once per block so the per-sample loop stays tight.
	const float SpeedScale = 1.0f + FMath::Clamp(SpeedGain, 0.0f, 3.0f) * TargetSpeed01;
	const float TargetGain = FMath::Clamp(TargetIntensity * SpeedScale, 0.0f, 1.0f) * MasterGain;

	for (int32 i = 0; i < NumSamples; ++i)
	{
		CurrentGain += (TargetGain - CurrentGain) * GainCoeff;
		CurrentHiss += (FMath::Clamp(HissMix, 0.0f, 1.0f) - CurrentHiss) * GainCoeff;
		OutAudio[i] = NextSample() * CurrentGain;
	}

	return NumSamples;
}
