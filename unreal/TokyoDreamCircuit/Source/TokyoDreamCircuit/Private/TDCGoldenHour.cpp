#include "TDCGoldenHour.h"

#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/World.h"
#include "EngineUtils.h"

ATDCGoldenHour::ATDCGoldenHour()
{
	PrimaryActorTick.bCanEverTick = false;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent = Root;

	Sun = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Sun"));
	Sun->SetupAttachment(Root);
	Sun->SetMobility(EComponentMobility::Movable);
	Sun->SetRelativeRotation(FRotator(-SunElevationDegrees, SunAzimuthDegrees, 0.0f));
	Sun->SetIntensity(SunIntensity);
	Sun->SetLightColor(SunColor);
	Sun->SetCastShadows(true);
	// This light drives the atmosphere, so the sky reddens as it drops.
	Sun->bAtmosphereSunLight = true;

	Atmosphere = CreateDefaultSubobject<USkyAtmosphereComponent>(TEXT("Atmosphere"));
	Atmosphere->SetupAttachment(Root);
	Atmosphere->SetMobility(EComponentMobility::Movable);

	SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
	SkyLight->SetupAttachment(Root);
	SkyLight->SetMobility(EComponentMobility::Movable);
	SkyLight->SetIntensity(SkyLightIntensity);
	SkyLight->bRealTimeCapture = true;
	SkyLight->bLowerHemisphereIsBlack = false;

	Fog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("Fog"));
	Fog->SetupAttachment(Root);
	Fog->SetMobility(EComponentMobility::Movable);
	Fog->SetFogDensity(FogDensity);
	Fog->SetFogHeightFalloff(FogHeightFalloff);
	Fog->SetFogInscatteringColor(FogInscattering);
	Fog->bEnableVolumetricFog = true;
}

void ATDCGoldenHour::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);

	if (bBuildOnConstruction)
	{
		ApplyGoldenHour();
	}
}

void ATDCGoldenHour::BeginPlay()
{
	Super::BeginPlay();

	if (!bBuildOnConstruction)
	{
		ApplyGoldenHour();
	}
}

void ATDCGoldenHour::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	DestroyPostProcess();
	Super::EndPlay(EndPlayReason);
}

void ATDCGoldenHour::SetSunElevation(float Degrees)
{
	SunElevationDegrees = FMath::Clamp(Degrees, -5.0f, 90.0f);
	ApplyGoldenHour();
}

void ATDCGoldenHour::ApplyGoldenHour()
{
	if (Sun)
	{
		Sun->SetRelativeRotation(FRotator(-SunElevationDegrees, SunAzimuthDegrees, 0.0f));
		Sun->SetIntensity(SunIntensity);
		Sun->SetLightColor(SunColor);
		Sun->SetCastShadows(bCastSunShadows);
		Sun->bAtmosphereSunLight = true;
		Sun->MarkRenderStateDirty();
	}

	if (Atmosphere)
	{
		// More Mie scattering = more haze around the sun, which is what makes a
		// golden hour read as air rather than a gradient.
		Atmosphere->SetMieScatteringScale(MieScatteringScale);
		Atmosphere->SetMieAnisotropy(0.78f);
		Atmosphere->SetRayleighScatteringScale(1.0f);
		Atmosphere->MarkRenderStateDirty();
	}

	if (SkyLight)
	{
		SkyLight->SetIntensity(SkyLightIntensity);
		SkyLight->bUseTemperature = true;
		SkyLight->Temperature = SkyLightColorTemperature;
		SkyLight->bRealTimeCapture = true;
		SkyLight->MarkRenderStateDirty();
	}

	if (Fog)
	{
		Fog->SetFogDensity(FogDensity);
		Fog->SetFogHeightFalloff(FogHeightFalloff);
		Fog->SetFogInscatteringColor(FogInscattering);
		Fog->SetDirectionalInscatteringColor(FogInscattering * 1.15f);
		Fog->SetDirectionalInscatteringExponent(4.0f);
		Fog->SetDirectionalInscatteringStartDistance(4000.0f);
		Fog->SetFogMaxOpacity(0.92f);
		Fog->bEnableVolumetricFog = bVolumetricFog;
		Fog->SetVolumetricFogExtinctionScale(0.9f);
		Fog->SetVolumetricFogAlbedo(FColor(255, 178, 138));
		Fog->SetVolumetricFogDistance(16000.0f);
		Fog->MarkRenderStateDirty();
	}

	if (bBuildPostProcess)
	{
		EnsurePostProcess();
	}
	else
	{
		DestroyPostProcess();
	}
}

void ATDCGoldenHour::EnsurePostProcess()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	if (!IsValid(PostProcess))
	{
		FActorSpawnParameters SpawnParams;
		SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		SpawnParams.Owner = this;

		PostProcess = World->SpawnActor<APostProcessVolume>(
			APostProcessVolume::StaticClass(),
			GetActorLocation(),
			FRotator::ZeroRotator,
			SpawnParams);
	}

	if (!PostProcess)
	{
		return;
	}

	PostProcess->bUnbound = true;
	PostProcess->BlendWeight = 1.0f;

	FPostProcessSettings& Settings = PostProcess->Settings;

	Settings.bOverride_BloomIntensity = true;
	Settings.BloomIntensity = BloomIntensity;
	Settings.bOverride_BloomThreshold = true;
	Settings.BloomThreshold = BloomThreshold;

	// A slightly hot, warm grade: gold in the highlights, cyan in the shadows.
	Settings.bOverride_ColorSaturation = true;
	Settings.ColorSaturation = FVector4(1.06f, 1.01f, 0.93f, 1.0f);
	Settings.bOverride_ColorContrast = true;
	Settings.ColorContrast = FVector4(1.05f, 1.03f, 1.02f, 1.0f);
	Settings.bOverride_ColorGain = true;
	Settings.ColorGain = FVector4(1.03f, 0.995f, 0.96f, 1.0f);
	Settings.bOverride_ColorOffset = true;
	Settings.ColorOffset = FVector4(0.0f, 0.0f, 0.006f, 0.0f);

	Settings.bOverride_AutoExposureBias = true;
	Settings.AutoExposureBias = 0.35f;

	Settings.bOverride_VignetteIntensity = true;
	Settings.VignetteIntensity = VignetteIntensity;
	Settings.bOverride_FilmGrainIntensity = true;
	Settings.FilmGrainIntensity = FilmGrainIntensity;
	Settings.bOverride_SceneFringeIntensity = true;
	Settings.SceneFringeIntensity = SceneFringeIntensity;
	Settings.bOverride_MotionBlurAmount = true;
	Settings.MotionBlurAmount = MotionBlurAmount;

	// Shallow depth of field for the chase camera. Photo Mode overrides this with
	// its own physical lens, so the two never fight.
	Settings.bOverride_DepthOfFieldFstop = true;
	Settings.DepthOfFieldFstop = 4.0f;
	Settings.bOverride_DepthOfFieldFocalDistance = true;
	Settings.DepthOfFieldFocalDistance = 3000.0f;
	Settings.bOverride_DepthOfFieldSensorWidth = true;
	Settings.DepthOfFieldSensorWidth = 36.0f;

	Settings.bOverride_LensFlareIntensity = true;
	Settings.LensFlareIntensity = 0.35f;
}

void ATDCGoldenHour::DestroyPostProcess()
{
	if (IsValid(PostProcess))
	{
		PostProcess->Destroy();
	}

	PostProcess = nullptr;
}
