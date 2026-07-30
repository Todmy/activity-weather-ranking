/**
 * The domain's view of one forecast day: named numbers, nothing else.
 *
 * Providers map their own response shapes into this, so no upstream field name
 * reaches a profile and no profile has to know that Open-Meteo calls the wind
 * `wind_speed_10m_max`. Swapping the provider is then a mapping change rather
 * than a scoring change.
 *
 * Every value is optional and nullable, and the two mean the same thing here:
 * we do not have it. That is deliberately not the same as zero — a missing
 * rainfall figure is not a dry day — and `scoreProfile` keeps them apart.
 */
export type WeatherInputs = {
  temperatureMax?: number | null
  temperatureMin?: number | null
  apparentTemperatureMax?: number | null
  precipitationSum?: number | null
  rainSum?: number | null
  snowfallSum?: number | null
  precipitationProbabilityMax?: number | null
  precipitationHours?: number | null
  windSpeedMax?: number | null
  windGustsMax?: number | null
  cloudCoverMean?: number | null
  uvIndexMax?: number | null
  sunshineDuration?: number | null
  daylightDuration?: number | null

  /** Marine series, present only where the Marine API has coverage. */
  waveHeightMax?: number | null
  wavePeriodMax?: number | null
  swellWaveHeightMax?: number | null
  swellWavePeriodMax?: number | null

  /**
   * Derived, not upstream: snowfall over this day and the two before it.
   * Computed by `withDerivedInputs` once per issuance — see decision #39.
   */
  snowfall3d?: number | null
}

/**
 * A local calendar date in the location's own timezone, never a UTC instant:
 * "how good is Tuesday" is a question about the traveller's Tuesday.
 */
export type DayWeather = WeatherInputs & { date: string }
