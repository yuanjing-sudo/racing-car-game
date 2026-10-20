#include "TDCGameMode.h"

#include "TDCHUD.h"
#include "TDCGoldenHour.h"
#include "TDCPlayerCar.h"
#include "TDCWeatherSystem.h"
#include "TDCWorldLandmarks.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"

ATDCGameMode::ATDCGameMode()
{
	DefaultPawnClass = ATDCPlayerCar::StaticClass();
	HUDClass = ATDCHUD::StaticClass();
}

void ATDCGameMode::BeginPlay()
{
	Super::BeginPlay();

	if (!bSpawnNeonHorizonWorld)
	{
		return;
	}

	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	FActorSpawnParameters SpawnParams;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	SpawnParams.Owner = this;

	// Lighting first: the city and the rain are lit by it from their first frame.
	if (!UGameplayStatics::GetActorOfClass(World, ATDCGoldenHour::StaticClass()))
	{
		UClass* Class = GoldenHourClass ? GoldenHourClass.Get() : ATDCGoldenHour::StaticClass();
		GoldenHour = World->SpawnActor<ATDCGoldenHour>(Class, FVector::ZeroVector, FRotator::ZeroRotator, SpawnParams);
	}

	if (!UGameplayStatics::GetActorOfClass(World, ATDCWorldLandmarks::StaticClass()))
	{
		UClass* Class = LandmarksClass ? LandmarksClass.Get() : ATDCWorldLandmarks::StaticClass();
		Landmarks = World->SpawnActor<ATDCWorldLandmarks>(Class, FVector::ZeroVector, FRotator::ZeroRotator, SpawnParams);
	}

	if (!UGameplayStatics::GetActorOfClass(World, ATDCWeatherSystem::StaticClass()))
	{
		UClass* Class = WeatherClass ? WeatherClass.Get() : ATDCWeatherSystem::StaticClass();
		Weather = World->SpawnActor<ATDCWeatherSystem>(Class, FVector::ZeroVector, FRotator::ZeroRotator, SpawnParams);
	}
}
