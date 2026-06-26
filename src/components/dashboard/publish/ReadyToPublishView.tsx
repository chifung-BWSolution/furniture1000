import { useEffect } from 'react';
import { ProductTableView } from '@/components/dashboard/ProductTableView';
import { useReadyToPublishList } from './useReadyToPublishList';

type ProductTableProps = React.ComponentProps<typeof ProductTableView>;

type Props = Omit<ProductTableProps, 'products' | 'readyToPublishMode' | 'serverList'> & {
  onRegisterReload?: (reload: () => void) => void;
  onTotalCountChange?: (count: number) => void;
};

export function ReadyToPublishView({ onRegisterReload, onTotalCountChange, ...tableProps }: Props) {
  const { products, serverList } = useReadyToPublishList();

  useEffect(() => {
    onRegisterReload?.(serverList.reload);
  }, [onRegisterReload, serverList.reload]);

  useEffect(() => {
    onTotalCountChange?.(serverList.totalCount);
  }, [onTotalCountChange, serverList.totalCount]);

  return (
    <ProductTableView
      {...tableProps}
      products={products}
      readyToPublishMode
      serverList={serverList}
    />
  );
}
