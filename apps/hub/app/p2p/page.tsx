import type {Metadata} from 'next';
import {P2PTransferPanel} from '@/components/p2p-transfer-panel';
import {PAIRING_RELAY_ORIGIN} from '@/lib/p2p-pairing.mjs';
import {V2PanelPage} from '@/components/v2/v2-panel-page';
import '../v2/v2.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'接続端末 | Hub',robots:{index:false,follow:false}};
export default function P2PPage(){return <V2PanelPage currentPath="/v2/node" title="接続端末" panelOwnsHeading wide><P2PTransferPanel accountMode allowRelaySelection pairOrigin={PAIRING_RELAY_ORIGIN}/></V2PanelPage>;}
