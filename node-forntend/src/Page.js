import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import EditVariableModal from './EditVariableModal';
import socket from './socket';

const svgCache = {};

const fetchSvg = (svgFile) => {
  if (svgCache[svgFile]) {
    return svgCache[svgFile].then ? svgCache[svgFile] : Promise.resolve(svgCache[svgFile]);
  }
  const promise = fetch(svgFile)
    .then(response => {
      if (!response.ok) throw new Error(`SVG ${svgFile} nicht gefunden.`);
      return response.text();
    })
    .then(text => {
      svgCache[svgFile] = text;
      console.log(`Loaded: ${svgFile}`);
      return text;
    })
    .catch(err => {
      console.error('Fehler beim Laden des SVG:', err);
      throw err;
    });
  svgCache[svgFile] = promise;
  return promise;
};

const Page = ({ svg: currentSvg, properties, allSvgs = [] }) => {
  const { t } = useTranslation();
  const currentSvgFile = `/assets/${currentSvg}.svg`;
  const [svgContent, setSvgContent] = useState('');
  const containerRef = useRef(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editRecords, setEditRecords] = useState([]); // Array für mehrere Records
  const [actions, setActions] = useState({});

  useEffect(() => {
    allSvgs.forEach(svgName => {
      const svgFile = `/assets/${svgName}.svg`;
      fetchSvg(svgFile).catch(() => {});
    });
  }, [allSvgs]);

  useEffect(() => {
    fetchSvg(currentSvgFile)
      .then(text => setSvgContent(text))
      .catch(() => {});
  }, [currentSvgFile]);

  useEffect(() => {
    if (!svgContent || !containerRef.current) return;

    let processedSvg = svgContent.replace(/{{(.*?)}}/g, (match, p1) => t(p1.trim()));
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(processedSvg, 'image/svg+xml');
    const ycontrol = xmlDoc.querySelector('ycontrol');

    const actionMap = {};
    if (ycontrol) {
      const propertyElements = ycontrol.querySelectorAll('property');
      propertyElements.forEach(propEl => {
        const propName = propEl.getAttribute('name');
        const value = properties.properties?.[propName]?.toString() ?? propEl.getAttribute('defaultvalue');
        const targets = propEl.querySelectorAll('target');
        targets.forEach(target => {
          const targetType = target.getAttribute('type');
          const targetElementName = target.getAttribute('element');
          let outputValue = null;
          const conditions = target.querySelectorAll('condition');
          if (conditions.length > 0) {
            for (const cond of conditions) {
              if (cond.hasAttribute('eq') && cond.getAttribute('eq') === value) {
                outputValue = cond.getAttribute('output');
                break;
              } else if (cond.hasAttribute('lt') && Number(value) < Number(cond.getAttribute('lt'))) {
                outputValue = cond.getAttribute('output');
                break;
              } else if (cond.hasAttribute('gt') && Number(value) > Number(cond.getAttribute('gt'))) {
                outputValue = cond.getAttribute('output');
                break;
              } else if (cond.hasAttribute('lte') && Number(value) <= Number(cond.getAttribute('lte'))) {
                outputValue = cond.getAttribute('output');
                break;
              } else if (cond.hasAttribute('gte') && Number(value) >= Number(cond.getAttribute('gte'))) {
                outputValue = cond.getAttribute('output');
                break;
              }
            }
          } else {
            outputValue = value;
          }
          if (outputValue !== null) {
            const elementsToUpdate = xmlDoc.querySelectorAll(`.${targetElementName}`);
            if (targetType === 'Style') {
              const selector = target.getAttribute('selector');
              elementsToUpdate.forEach(el => (el.style[selector] = outputValue));
            } else if (targetType === 'Content') {
              elementsToUpdate.forEach(el => {
                const tspan = el.querySelector('tspan');
                (tspan || el).textContent = outputValue;
              });
            }
          }
        });
      });

      const actionElements = ycontrol.querySelectorAll('action');
      actionElements.forEach(actionEl => {
        const actionName = actionEl.getAttribute('name');
        const trigger = actionEl.getAttribute('triggers');
        const element = actionEl.getAttribute('element');
        if (trigger === 'click' && element && actionName) {
          actionMap[actionName] = element;
        }
      });
    }

    const svgEl = xmlDoc.querySelector('svg');
    if (svgEl) {
      if (!svgEl.getAttribute('viewBox')) {
        svgEl.setAttribute('viewBox', '0 0 1024 423');
      }
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
      svgEl.setAttribute('width', '100%');
      svgEl.setAttribute('height', '100%');
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svgEl.style.width = '100%';
      svgEl.style.height = '100%';
    }

    containerRef.current.innerHTML = new XMLSerializer().serializeToString(xmlDoc);

    const cleanupListeners = () => {
      Object.entries(actions).forEach(([actionName, elementClass]) => {
        const elements = containerRef.current.querySelectorAll(`.${elementClass}`);
        elements.forEach(el => {
          el.removeEventListener('click', handleActionClick);
        });
      });
    };

    setActions(actionMap);
    Object.entries(actionMap).forEach(([actionName, elementClass]) => {
      const elements = containerRef.current.querySelectorAll(`.${elementClass}`);
      elements.forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => handleActionClick(actionName));
      });
    });

    return cleanupListeners;
  }, [svgContent, properties, t]);

  const handleActionClick = (actionName) => {
    const qhmiVariableNames = properties.actions?.[actionName];
    console.log('Properties:', properties);
    console.log('ActionName:', actionName, 'QHMI Variables:', qhmiVariableNames);
    if (!qhmiVariableNames || !Array.isArray(qhmiVariableNames) || qhmiVariableNames.length === 0) {
      console.warn(`Keine QHMI-Variablen für Aktion '${actionName}' definiert.`);
      return;
    }
    socket.emit('request-settings', {});
    socket.once('settings-update', (data) => {
      const records = data.filter(row => qhmiVariableNames.includes(row.NAME));
      if (records.length > 0) {
        setEditRecords(records);
        setEditModalVisible(true);
      } else {
        console.warn(`Keine QHMI_VARIABLES-Zeilen für '${qhmiVariableNames}' gefunden.`);
      }
    });
  };

  const handleUpdateSuccess = () => {
    setEditModalVisible(false);
  };

  return (
    <>
      <div style={{ width: '100%', height: '100%', overflow: 'hidden' }} ref={containerRef} />
      {editModalVisible && editRecords.length > 0 && (
        <EditVariableModal
          visible={editModalVisible}
          records={editRecords} // Array statt einzelnem record
          onCancel={() => setEditModalVisible(false)}
          onUpdateSuccess={handleUpdateSuccess}
        />
      )}
    </>
  );
};

export default Page;