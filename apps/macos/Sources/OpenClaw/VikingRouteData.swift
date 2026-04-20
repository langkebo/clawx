import Foundation

struct VikingCacheStats: Codable {
    let size: Int
    let maxSize: Int
    let ttlMs: Int
    let hitRate: Double
}

struct VikingRouteStats: Codable {
    let total: Int
    let ruleHits: Int
    let ruleHitRate: Double
    let reroutes: Int
}

struct VikingOptimizations: Codable {
    let P0_dynamic_reroute: Bool
    let P1_post_compact_reroute: Bool
    let P2_model_switching: Bool
    let P3_parallel_routing: Bool
    let P4_rule_engine: Bool
    let P5_feedback_loop: Bool
}

struct VikingStatsSnapshot: Codable {
    let enabled: Bool
    let cache: VikingCacheStats
    let routes: VikingRouteStats
    let optimizations: VikingOptimizations
}

enum VikingFormatting {
    static func formatPercent(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        return String(format: "%.1f%%", value * 100)
    }

    static func cacheLabel(_ stats: VikingCacheStats) -> String {
        return "\(stats.size)/\(stats.maxSize) entries · \(Self.formatPercent(stats.hitRate)) hit"
    }

    static func routeLabel(_ stats: VikingRouteStats) -> String {
        return "\(stats.ruleHits)/\(stats.total) rules · \(Self.formatPercent(stats.ruleHitRate))"
    }

    static func activeOptimizations(_ opts: VikingOptimizations) -> Int {
        var count = 0
        if opts.P0_dynamic_reroute { count += 1 }
        if opts.P1_post_compact_reroute { count += 1 }
        if opts.P2_model_switching { count += 1 }
        if opts.P3_parallel_routing { count += 1 }
        if opts.P4_rule_engine { count += 1 }
        if opts.P5_feedback_loop { count += 1 }
        return count
    }
}
