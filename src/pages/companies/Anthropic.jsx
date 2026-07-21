import { C } from '../../config/colors';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import ArrTrajectoryCard from '../../components/chart/ArrTrajectoryCard';
import EditableGrid from '../../components/chart/EditableGrid';
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
