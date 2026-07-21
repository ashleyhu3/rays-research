import { C } from '../../config/colors';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import ArrTrajectoryCard from '../../components/chart/ArrTrajectoryCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { modelDailyTokenCard } from '../../components/chart/ModelDailyTokenCard';
import { useData } from '../../context/DataContext';

export default function DemandAnthropic({ weeks: W }) {
  const { liveData: ld } = useData();

  const arrSeries = ld?.epochRevenue?.series?.['Anthropic'];

  return (
    <EditableGrid viewId="demand-anthropic">
      {arrSeries?.length > 1 && (
        <ArrTrajectoryCard
          chartId="an-arr"
          series={arrSeries}
          color={C.anthropic}
          name="Anthropic"
          height={300}
          pinTop
          defaultCol="left"
        />
      )}

      {orComboCard(ld?.openrouterRanks, 'Anthropic', W, C.anthropic, 'an', ld)}

      {modelDailyTokenCard({
        ranks: ld?.openrouterRanks,
        provider: 'Anthropic',
        modelMatch: 'claude-5-fable',
        displayName: 'Claude Fable 5',
        chartId: 'an-fable5-daily',
        color: C.anthropic,
        srcUrl: 'https://openrouter.ai/anthropic/claude-5-fable',
      })}

      <RevPerTokenCard
        chartId="an-revtoken"
        provider="Anthropic"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.anthropic}
      />
    </EditableGrid>
  );
}
