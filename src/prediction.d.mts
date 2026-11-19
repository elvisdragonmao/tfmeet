export interface PerformanceHistory {
	event: string;
	gender: "M" | "F";
	age: number;
	mark: number;
	year?: number;
	athleteId?: string;
	weightKg?: number;
	specificationMm?: number;
}

export interface PredictionRequest {
	event: string;
	gender: "M" | "F";
	mark: number;
	currentAge: number;
	targetAge?: number;
	ageBasis?: "calendar-year";
	currentYear?: number;
	currentWeightKg?: number;
	targetWeightKg?: number;
	specificationMm?: number;
	athleteId?: string;
	history?: PerformanceHistory[];
}

export interface PredictionResult {
	status: "ok";
	mode: "age" | "joint" | "weight";
	event: string;
	unit: "m" | "s";
	model: string;
	modelVersion: string;
	estimate: number;
	interval: { low: number; high: number; nominal: number; observedCoverage: number; coverage95: [number, number]; calibrationN: number };
	validation: { n: number; mae: number; rmse: number; mape: number; coverage: number; baselineMae: number; train: number; tune: number; calibration: number; test: number; testN: number };
	applicability: {
		fromSpecification: number | null;
		toSpecification: number | null;
		ageBasis: "calendar-year";
		validatedStartAges: number[];
		anchorRange: [number, number];
		currentCompletedAgeRange: [number, number];
		targetCompletedAgeRange: [number, number];
		horizon: number;
		historyMarksUsed: number;
		anchorStatistic: string;
		limitations: string[];
	};
}

export function predictPerformance(artifact: unknown, input: PredictionRequest): PredictionResult | { status: "unavailable"; reason: string; detail: string; modelVersion: string | null };
export interface PredictionArtifact {
	modelVersion: string;
	dataset: { dataRulesVersion: number };
}
