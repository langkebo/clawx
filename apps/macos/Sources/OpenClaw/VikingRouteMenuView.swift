import SwiftUI

struct VikingRouteMenuView: View {
    let stats: VikingStatsSnapshot

    private let paddingTop: CGFloat = 6
    private let paddingBottom: CGFloat = 6
    private let paddingLeading: CGFloat = 20
    private let paddingTrailing: CGFloat = 10

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text("Viking Routing")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 10)
                if self.stats.enabled {
                    Text(self.enabledLabel)
                        .font(.caption)
                        .foregroundStyle(.green)
                } else {
                    Text("Off")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if self.stats.enabled {
                self.detailRows
            }
        }
        .padding(.top, self.paddingTop)
        .padding(.bottom, self.paddingBottom)
        .padding(.leading, self.paddingLeading)
        .padding(.trailing, self.paddingTrailing)
        .frame(minWidth: 300, maxWidth: .infinity, alignment: .leading)
        .transaction { txn in txn.animation = nil }
    }

    private var enabledLabel: String {
        let active = VikingFormatting.activeOptimizations(self.stats.optimizations)
        return "\(active)/6 opts"
    }

    private var detailRows: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(VikingFormatting.cacheLabel(self.stats.cache))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 4) {
                Image(systemName: "gauge.with.dots.needle.33percent")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(VikingFormatting.routeLabel(self.stats.routes))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if self.stats.routes.reroutes > 0 {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                    Text("\(self.stats.routes.reroutes) re-routes")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
        }
    }
}
