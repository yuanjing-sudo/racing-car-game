#include "TDCHUD.h"

#include "TDCPhotoModeComponent.h"
#include "TDCPhotoPawn.h"
#include "TDCPlayerCar.h"
#include "TDCWorldLandmarks.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"

namespace
{
	const FLinearColor Ink(0.95f, 0.96f, 0.94f, 1.0f);
	const FLinearColor Dim(0.72f, 0.76f, 0.78f, 1.0f);
	const FLinearColor NeonPink(1.0f, 0.18f, 0.55f, 1.0f);
	const FLinearColor NeonCyan(0.20f, 0.85f, 1.0f, 1.0f);
	const FLinearColor Warm(1.0f, 0.66f, 0.30f, 1.0f);
}

ATDCPlayerCar* ATDCHUD::FindCar()
{
	if (CachedCar.IsValid())
	{
		return CachedCar.Get();
	}

	for (TActorIterator<ATDCPlayerCar> It(GetWorld()); It; ++It)
	{
		CachedCar = *It;
		return CachedCar.Get();
	}

	return nullptr;
}

ATDCWorldLandmarks* ATDCHUD::FindLandmarks()
{
	if (CachedLandmarks.IsValid())
	{
		return CachedLandmarks.Get();
	}

	for (TActorIterator<ATDCWorldLandmarks> It(GetWorld()); It; ++It)
	{
		CachedLandmarks = *It;
		return CachedLandmarks.Get();
	}

	return nullptr;
}

UTDCPhotoModeComponent* ATDCHUD::FindPhotoMode(ATDCPlayerCar* Car)
{
	return Car ? Car->FindComponentByClass<UTDCPhotoModeComponent>() : nullptr;
}

void ATDCHUD::DrawHUD()
{
	Super::DrawHUD();

	if (!Canvas)
	{
		return;
	}

	// 1080p is the reference height; everything scales linearly from there.
	const float Scale = FMath::Clamp(Canvas->SizeY / 1080.0f, 0.4f, 4.0f);

	if (ATDCPhotoPawn* PhotoPawn = Cast<ATDCPhotoPawn>(GetOwningPawn()))
	{
		DrawPhotoHud(*PhotoPawn, Scale);
		return;
	}

	ATDCPlayerCar* Car = FindCar();
	if (!Car)
	{
		return;
	}

	DrawRaceHud(*Car, FindPhotoMode(Car), Scale);
}

void ATDCHUD::DrawRaceHud(ATDCPlayerCar& Car, UTDCPhotoModeComponent* Photo, float Scale)
{
	const float W = Canvas->SizeX;
	const float H = Canvas->SizeY;
	const float Zen = Car.GetZenAlpha();

	// Zen fades the readout, never the road.
	const float Alpha = FMath::Clamp(1.0f - Zen * 0.88f, 0.12f, 1.0f);

	const float Speed = Car.GetAbsoluteSpeedKmh();
	const float Left = 56.0f * Scale;
	const float Bottom = H - 64.0f * Scale;

	// ---- speed and gear, bottom right -----------------------------------
	const FString SpeedText = FString::Printf(TEXT("%d"), FMath::RoundToInt(Speed));
	float SpeedW = 0.0f;
	float SpeedH = 0.0f;
	GetTextSize(SpeedText, SpeedW, SpeedH, GEngine->GetLargeFont(), 3.0f * Scale);

	const float SpeedX = W - Left - SpeedW;
	const float SpeedY = Bottom - SpeedH;
	DrawText(SpeedText, FLinearColor(Ink.R, Ink.G, Ink.B, Alpha), SpeedX, SpeedY, GEngine->GetLargeFont(), 3.0f * Scale);
	DrawText(TEXT("km/h"), FLinearColor(Dim.R, Dim.G, Dim.B, Alpha), SpeedX + SpeedW + 8.0f * Scale, SpeedY + SpeedH - 30.0f * Scale,
		GEngine->GetMediumFont(), 1.1f * Scale);

	const FString GearText = FString::Printf(TEXT("%d"), Car.GetCurrentGear());
	DrawText(GearText, FLinearColor(Warm.R, Warm.G, Warm.B, Alpha), W - Left - 150.0f * Scale, SpeedY - 44.0f * Scale,
		GEngine->GetMediumFont(), 1.3f * Scale);
	DrawText(TEXT("GEAR"), FLinearColor(Dim.R, Dim.G, Dim.B, Alpha * 0.8f), W - Left - 148.0f * Scale, SpeedY - 18.0f * Scale,
		GEngine->GetSmallFont(), 0.9f * Scale);

	// rpm bar
	const float RpmFraction = FMath::Clamp((Car.GetEngineRpm() - 850.0f) / 8600.0f, 0.0f, 1.0f);
	DrawBar(W - Left - 240.0f * Scale, Bottom + 10.0f * Scale, 240.0f * Scale, 7.0f * Scale, RpmFraction,
		FLinearColor(NeonCyan.R, NeonCyan.G, NeonCyan.B, Alpha), FLinearColor(1.0f, 1.0f, 1.0f, 0.12f * Alpha));

	// ---- drift chain and score, bottom left -----------------------------
	const int32 Chain = Car.GetDriftChain();
	if (Chain >= 2)
	{
		const float Pulse = 1.0f + 0.12f * FMath::Sin(GetWorld()->GetTimeSeconds() * 9.0f) * Car.GetDriftChainAlpha();
		const FString ChainText = FString::Printf(TEXT("x%d"), Chain);
		DrawText(ChainText, FLinearColor(NeonPink.R, NeonPink.G, NeonPink.B, Alpha), Left, Bottom - 100.0f * Scale,
			GEngine->GetLargeFont(), 1.8f * Scale * Pulse);
		DrawBar(Left, Bottom - 44.0f * Scale, 220.0f * Scale, 6.0f * Scale, Car.GetDriftChainAlpha(),
			FLinearColor(NeonPink.R, NeonPink.G, NeonPink.B, Alpha), FLinearColor(1.0f, 1.0f, 1.0f, 0.10f * Alpha));
	}

	if (Car.GetRunScore() > 0.5f)
	{
		const FString ScoreText = FString::Printf(TEXT("DRIFT  %d"), FMath::RoundToInt(Car.GetRunScore()));
		DrawText(ScoreText, FLinearColor(Dim.R, Dim.G, Dim.B, Alpha), Left, Bottom - 16.0f * Scale,
			GEngine->GetSmallFont(), 1.0f * Scale);
	}

	// ---- Zen glyph, top centre ------------------------------------------
	if (Zen > 0.02f)
	{
		const FString ZenText = TEXT("Z E N");
		float ZenW = 0.0f;
		float ZenH = 0.0f;
		GetTextSize(ZenText, ZenW, ZenH, GEngine->GetMediumFont(), 1.6f * Scale);
		DrawText(ZenText, FLinearColor(Ink.R, Ink.G, Ink.B, Zen * 0.95f), (W - ZenW) * 0.5f, 64.0f * Scale,
			GEngine->GetMediumFont(), 1.6f * Scale);
		DrawLine(W * 0.5f - 46.0f * Scale, 108.0f * Scale, W * 0.5f + 46.0f * Scale, 108.0f * Scale,
			FLinearColor(1.0f, 1.0f, 1.0f, Zen * 0.35f), 1.0f);
	}

	// ---- controls hint ---------------------------------------------------
	if (Photo && !Photo->IsActive())
	{
		DrawText(TEXT("P  PHOTO MODE"), FLinearColor(1.0f, 1.0f, 1.0f, 0.34f * Alpha), Left, 52.0f * Scale,
			GEngine->GetSmallFont(), 0.95f * Scale);
	}

	if (bShowLandmarkCompass)
	{
		DrawCompass(Scale, Alpha);
	}
}

void ATDCHUD::DrawCompass(float Scale, float Alpha)
{
	ATDCWorldLandmarks* Landmarks = FindLandmarks();
	if (!Landmarks || !PlayerOwner || !PlayerOwner->PlayerCameraManager)
	{
		return;
	}

	const float W = Canvas->SizeX;
	const float CameraYaw = PlayerOwner->PlayerCameraManager->GetCameraRotation().Yaw;
	const FVector CameraLocation = PlayerOwner->PlayerCameraManager->GetCameraLocation();
	const float HalfAngleRad = FMath::DegreesToRadians(CompassHalfAngleDeg);
	const int32 Count = Landmarks->GetLandmarkCount();

	for (int32 i = 0; i < Count; ++i)
	{
		const FVector Location = Landmarks->GetLandmarkLocation(i);
		const FVector ToLandmark = Location - CameraLocation;
		const float Bearing = FMath::RadiansToDegrees(FMath::Atan2(ToLandmark.Y, ToLandmark.X));
		const float Relative = FMath::FindDeltaAngleDegrees(CameraYaw, Bearing);
		if (FMath::Abs(Relative) > CompassHalfAngleDeg)
		{
			continue;
		}

		const float X = W * 0.5f + (FMath::DegreesToRadians(Relative) / HalfAngleRad) * W * 0.30f;
		const float Y = 26.0f * Scale;
		const float DistanceKm = ToLandmark.Size() / 100000.0f;

		// A tick, a diamond and a label: readable at 300 km/h.
		const float Tick = 12.0f * Scale;
		DrawLine(X, Y, X, Y + Tick, FLinearColor(NeonCyan.R, NeonCyan.G, NeonCyan.B, 0.65f * Alpha), 2.0f);
		DrawLine(X, Y + Tick, X - Tick * 0.4f, Y + Tick * 1.5f, FLinearColor(NeonCyan.R, NeonCyan.G, NeonCyan.B, 0.65f * Alpha), 2.0f);
		DrawLine(X, Y + Tick, X + Tick * 0.4f, Y + Tick * 1.5f, FLinearColor(NeonCyan.R, NeonCyan.G, NeonCyan.B, 0.65f * Alpha), 2.0f);

		const FString Label = FString::Printf(TEXT("%s  %.1f KM"), *Landmarks->GetLandmarkName(i).ToUpper(), DistanceKm);
		float LabelW = 0.0f;
		float LabelH = 0.0f;
		GetTextSize(Label, LabelW, LabelH, GEngine->GetSmallFont(), 0.78f * Scale);
		DrawText(Label, FLinearColor(Dim.R, Dim.G, Dim.B, 0.75f * Alpha), X - LabelW * 0.5f, Y + Tick * 1.9f,
			GEngine->GetSmallFont(), 0.78f * Scale);
	}
}

void ATDCHUD::DrawPhotoHud(ATDCPhotoPawn& Pawn, float Scale)
{
	const float W = Canvas->SizeX;
	const float H = Canvas->SizeY;
	const float Aspect = 2.39f;

	// The camera constrains to 2.39:1, so the live image sits inside black bars.
	float ImageW = W;
	float ImageH = W / Aspect;
	if (ImageH > H)
	{
		ImageH = H;
		ImageW = H * Aspect;
	}
	const float Left = (W - ImageW) * 0.5f;
	const float Top = (H - ImageH) * 0.5f;

	// Rule of thirds, deliberately faint.
	const FLinearColor Grid(1.0f, 1.0f, 1.0f, 0.16f);
	for (int32 i = 1; i <= 2; ++i)
	{
		const float GX = Left + ImageW * (static_cast<float>(i) / 3.0f);
		const float GY = Top + ImageH * (static_cast<float>(i) / 3.0f);
		DrawLine(GX, Top, GX, Top + ImageH, Grid, 1.0f);
		DrawLine(Left, GY, Left + ImageW, GY, Grid, 1.0f);
	}

	// Corner brackets.
	const float Bracket = 34.0f * Scale;
	const FLinearColor BracketColor(1.0f, 1.0f, 1.0f, 0.55f);
	DrawLine(Left, Top, Left + Bracket, Top, BracketColor, 2.0f);
	DrawLine(Left, Top, Left, Top + Bracket, BracketColor, 2.0f);
	DrawLine(Left + ImageW, Top, Left + ImageW - Bracket, Top, BracketColor, 2.0f);
	DrawLine(Left + ImageW, Top, Left + ImageW, Top + Bracket, BracketColor, 2.0f);
	DrawLine(Left, Top + ImageH, Left + Bracket, Top + ImageH, BracketColor, 2.0f);
	DrawLine(Left, Top + ImageH, Left, Top + ImageH - Bracket, BracketColor, 2.0f);
	DrawLine(Left + ImageW, Top + ImageH, Left + ImageW - Bracket, Top + ImageH, BracketColor, 2.0f);
	DrawLine(Left + ImageW, Top + ImageH, Left + ImageW, Top + ImageH - Bracket, BracketColor, 2.0f);

	// Header chip.
	const FString Header = TEXT("PHOTO MODE");
	DrawText(Header, NeonPink, Left + 14.0f * Scale, Top + 14.0f * Scale, GEngine->GetSmallFont(), 1.1f * Scale);
	DrawText(TEXT("WORLD FROZEN"), FLinearColor(1.0f, 1.0f, 1.0f, 0.45f), Left + 14.0f * Scale, Top + 40.0f * Scale,
		GEngine->GetSmallFont(), 0.8f * Scale);

	// Lens readout, bottom of the image.
	const FString Lens = FString::Printf(TEXT("FOV %.0f\u00B0     f/%.1f     FOCUS %.1f m"),
		Pawn.GetFOV(), Pawn.GetAperture(), Pawn.GetFocusDistance() / 100.0f);
	DrawText(Lens, Ink, Left + 14.0f * Scale, Top + ImageH - 66.0f * Scale, GEngine->GetMediumFont(), 1.0f * Scale);

	const FString Controls = TEXT("[P] EXIT     [F12] CAPTURE     [WHEEL] ZOOM     [Z/X] APERTURE     [PGUP/PGDN] FOCUS     [SHIFT] BOOST");
	DrawText(Controls, FLinearColor(1.0f, 1.0f, 1.0f, 0.5f), Left + 14.0f * Scale, Top + ImageH - 40.0f * Scale,
		GEngine->GetSmallFont(), 0.8f * Scale);

	DrawText(TEXT("WASD  MOVE     E/Q  UP/DOWN     MOUSE  LOOK"), FLinearColor(1.0f, 1.0f, 1.0f, 0.35f),
		Left + 14.0f * Scale, Top + ImageH - 22.0f * Scale, GEngine->GetSmallFont(), 0.72f * Scale);
}

void ATDCHUD::DrawBar(float X, float Y, float Width, float Height, float Fraction, const FLinearColor& Fill, const FLinearColor& Back)
{
	DrawRect(Back, X, Y, Width, Height);
	DrawRect(Fill, X, Y, Width * FMath::Clamp(Fraction, 0.0f, 1.0f), Height);
}
