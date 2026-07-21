import { C } from '../../config/colors';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import ArrTrajectoryCard from '../../components/chart/ArrTrajectoryCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

export default function DemandGoogle({ weeks: W }) {
  const { liveData: ld } = useData();

  const arrSeries = ld?.epochRevenue?.series?.['Google'];

  return (
    <EditableGrid viewId="demand-google">
      {orComboCard(ld?.openrouterRanks, 'Google', W, C.google, 'goo', ld)}

      <RevPerTokenCard
        chartId="goo-revtoken"
        provider="Google"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.google}
        ticker="GOOGL"
      />

      {arrSeries?.length > 1 && (
        <ArrTrajectoryCard
          chartId="goo-arr"
          series={arrSeries}
          color={C.google}
          name="Google"
          height={300}
          defaultFull
        />
      )}
    </EditableGrid>
  );
}
