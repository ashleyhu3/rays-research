import { C } from '../../config/colors';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import ArrTrajectoryCard from '../../components/chart/ArrTrajectoryCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

export default function DemandOpenAI({ weeks: W }) {
  const { liveData: ld } = useData();

  const arrSeries = ld?.epochRevenue?.series?.['OpenAI'];

  return (
    <EditableGrid viewId="demand-openai">
      {arrSeries?.length > 1 && (
        <ArrTrajectoryCard
          chartId="oa-arr"
          series={arrSeries}
          color={C.openai}
          name="OpenAI"
          height={300}
          pinTop
          defaultCol="left"
        />
      )}

      {orComboCard(ld?.openrouterRanks, 'OpenAI', W, C.openai, 'oa', ld)}

      <RevPerTokenCard
        chartId="oa-revtoken"
        provider="OpenAI"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.openai}
      />
    </EditableGrid>
  );
}
