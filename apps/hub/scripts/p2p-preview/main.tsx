import {createRoot} from 'react-dom/client';
import {P2PTransferPanel} from '../../components/p2p-transfer-panel';
import '../../app/color-system.css';
import './shell.css';

createRoot(document.getElementById('root')!).render(<main><p className="p2p-preview-label">Hub · P2P テスト</p><P2PTransferPanel/></main>);
