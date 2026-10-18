#include "TDCGameMode.h"
#include "TDCPlayerCar.h"

ATDCGameMode::ATDCGameMode()
{
	DefaultPawnClass = ATDCPlayerCar::StaticClass();
}
