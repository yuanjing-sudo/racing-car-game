#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "TDCHUD.generated.h"

class ATDCPlayerCar;
class ATDCPhotoPawn;
class ATDCWorldLandmarks;
class UTDCPhotoModeComponent;

/**
 * ATDCHUD
 *
 * Canvas HUD, drawn entirely in code so there is no UMG asset to author:
 *
 *   - speed, gear and an rpm bar, bottom right;
 *   - drift chain and score, bottom left;
 *   - a landmark compass (Tokyo Tower, Skytree, Fuji, Rainbow Bridge) along the
 *     top edge, so the skyline doubles as navigation;
 *   - Zen: above ZenStartKmh the whole readout fades, leaving a single quiet
 *     ZEN glyph and the road. At ZenFullKmh the HUD is effectively gone;
 *   - Photo Mode: a rule-of-thirds framing grid and a live lens readout instead
 *     of the race HUD.
 *
 * Everything is laid out in fractions of the canvas, so it scales from 720p to
 * 4K without a second set of numbers.
 */
UCLASS()
class TOKYODREAMCIRCUIT_API ATDCHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

	/** Show the landmark chips. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HUD")
	bool bShowLandmarkCompass = true;

	/** How far from centre a landmark may be before its chip is hidden,
	 *  in degrees. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HUD", meta = (ClampMin = "10.0", ClampMax = "180.0"))
	float CompassHalfAngleDeg = 75.0f;

private:
	ATDCPlayerCar* FindCar();
	ATDCWorldLandmarks* FindLandmarks();
	UTDCPhotoModeComponent* FindPhotoMode(ATDCPlayerCar* Car);

	void DrawRaceHud(ATDCPlayerCar& Car, UTDCPhotoModeComponent* Photo, float Scale);
	void DrawCompass(float Scale, float Alpha);
	void DrawPhotoHud(ATDCPhotoPawn& Pawn, float Scale);

	/** Bar helper, all coordinates in pixels. */
	void DrawBar(float X, float Y, float Width, float Height, float Fraction, const FLinearColor& Fill, const FLinearColor& Back);

	TWeakObjectPtr<ATDCPlayerCar> CachedCar;
	TWeakObjectPtr<ATDCWorldLandmarks> CachedLandmarks;
};
