# Scoring methodology

The default score weights outcome 30%, validation quality 25%, token efficiency 15%, cost efficiency 10%, rework 10%, and attribution confidence 10%. All normalization lives in `@tokenfaxx/scoring`. Process success is separate from task outcome: an exit code of zero without validation produces `completed-unverified`, not a verified completion.

Outcome and evidence come first. Token/cost efficiency is only normalized for a completed outcome, so a failed cheap attempt cannot outrank a completed validated attempt merely by spending less. Missing token or pricing data is excluded rather than converted to zero. A score is withheld when an outcome plus meaningful quality/attribution evidence is absent.

Token efficiency requires an explicit small/medium/large task profile. Cost efficiency requires a task maximum cost. Rework is a transparent metadata-only estimate from periodic Git state transitions and validation failures. Attribution states association, never causation, and lists both supporting and missing evidence. Data completeness, outcome confidence, usage accuracy, attribution confidence and overall report confidence are reported separately.
