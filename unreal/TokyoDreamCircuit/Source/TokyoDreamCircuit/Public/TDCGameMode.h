#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "TDCGameMode.generated.h"

/**
 * ATDCGameMode
 *
 * Default game mode for the circuit: spawns the player car at the PlayerStart
 * (or at the origin if the level has none).
 */
UCLASS()
class TOKYODREAMCIRCUIT_API ATDCGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ATDCGameMode();
};
