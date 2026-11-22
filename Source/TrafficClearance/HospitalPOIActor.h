// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Components/SplineComponent.h"
#include "HospitalPOIActor.generated.h"

/**
 * Hospital Point of Interest (POI) Actor representing emergency destination facilities
 * across the Bengaluru Emergency Vehicle Green Corridor Digital Twin.
 */
UCLASS(BlueprintType, Blueprintable)
class TRAFFICCLEARANCE_API AHospitalPOIActor : public AActor
{
	GENERATED_BODY()

public:
	AHospitalPOIActor();

	virtual void BeginPlay() override;

	/** Root scene component */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Components")
	USceneComponent* SceneRoot;

	/** Unique Hospital Identifier (e.g., "HOSP_VICTORIA", "HOSP_BOWRING") */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|HospitalMetadata")
	FString HospitalId;

	/** Facility display name (e.g., "Victoria Hospital - Emergency Trauma Care") */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|HospitalMetadata")
	FString HospitalName;

	/** WGS84 Geographic Location (X=Longitude, Y=Latitude, Z=Altitude in meters) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|HospitalMetadata")
	FVector WGS84Location = FVector::ZeroVector;

	/** Categorization tier (e.g., "Level 1 Trauma Center", "Super Specialty Hospital") */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|HospitalMetadata")
	FString EmergencyTier = TEXT("Level 1 Trauma Center");

	/** Current available emergency bed capacity */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|HospitalMetadata")
	int32 EmergencyBedCapacity = 24;

	/** Whether 24/7 immediate trauma surgery team is active */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|HospitalMetadata")
	bool bHasActiveTraumaCenter = true;

	/** Emergency desk dispatch contact number */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|HospitalMetadata")
	FString ContactNumber = TEXT("108 / +91-80-26701150");

	/** Reference to the nearest road spline for incoming emergency vehicle navigation */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Navigation")
	TObjectPtr<USplineComponent> NearestRoadSpline = nullptr;

	/** Nearest ingress location on the road spline in Unreal Cartesian coordinates (cm) */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Navigation")
	FVector NearestRoadIngressPoint = FVector::ZeroVector;

	/**
	 * Associates this hospital POI with a road spline network and calculates nearest ingress point.
	 *
	 * @param RoadSpline The adjacent road spline component.
	 * @param IngressPoint Cartesian coordinate for ambulance handover.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Navigation")
	void SetNearestRoadReference(USplineComponent* RoadSpline, const FVector& IngressPoint);

	/**
	 * Returns true if the hospital currently has open emergency capacity for incoming patients.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|HospitalMetadata")
	bool HasEmergencyCapacity() const { return EmergencyBedCapacity > 0 && bHasActiveTraumaCenter; }
};
