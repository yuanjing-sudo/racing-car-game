#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "TDCGameMode.generated.h"

class ATDCGoldenHour;
class ATDCWeatherSystem;
class ATDCWorldLandmarks;

/**
 * ATDCGameMode
 *
 * Spawns the player car at the PlayerStart (or at the origin if the level has
 * none), and, unless the level already provides them, the three Neon Horizon
 * actors: the golden-hour light rig, the skyline and landmarks, and the rain.
 *
 * That means a level with nothing but a PlayerStart already runs the full
 * "drive the postcard" set-up. Designers who want to place the actors by hand
 * can drop them in and uncheck bSpawnNeonHorizonWorld, or just leave them in the
 * level: the spawn is skipped when an actor of the same class is present.
 */
UCLASS()
class TOKYODREAMCIRCUIT_API ATDCGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ATDCGameMode();

	virtual void BeginPlay() override;

	/** Spawn the sky, city and rain if the level has none. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Neon Horizon")
	bool bSpawnNeonHorizonWorld = true;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Neon Horizon")
	TSubclassOf<ATDCGoldenHour> GoldenHourClass;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Neon Horizon")
	TSubclassOf<ATDCWorldLandmarks> LandmarksClass;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Neon Horizon")
	TSubclassOf<ATDCWeatherSystem> WeatherClass;

private:
	UPROPERTY()
	TObjectPtr<ATDCGoldenHour> GoldenHour;

	UPROPERTY()
	TObjectPtr<ATDCWorldLandmarks> Landmarks;

	UPROPERTY()
	TObjectPtr<ATDCWeatherSystem> Weather;
};
