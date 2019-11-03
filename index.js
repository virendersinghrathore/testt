import {debounce} from './debounce';
import {set,get} from 'idb-keyval';
import {geoToH3,polyfill} from 'h3-js';
import {SpeechConfig,AudioConfig,SpeechRecognizer} from 'microsoft-cognitiveservices-speech-sdk';
import {TrufactorDemo} from './TrufactorDemo';

const defaultFilters = Object.freeze({
  age: 'default',
  gender: 'default',
  ethnicity: 'default',
  income: 'default'
});

export class Trufactor{
  constructor({domain='',}={}){
    this.queuedRequests = [];
    this.progress = 0;
    this.domain = domain;
    if(!domain){
      throw new Error('Domain parameter missing in library initialization.');
    }else if(domain==='demo'){
      return new TrufactorDemo();
    } //end if
    this.loaded = Promise.all([
      fetch(`${this.domain}/datesAvailable`),
      fetch(`${this.domain}/cognitive`)
    ]).then(async ([datesAvailable,cognitiveToken])=>{
        this.datesAvailable = await datesAvailable.json();
        this.cognitiveToken = await cognitiveToken.json();
        this.lastAvailableDate = this.datesAvailable.sort((a,b)=>a<b?1:-1)[0];
        this.selectedDate = this.lastAvailableDate;
        this.selectedDateIndex = this.datesAvailable.findIndex(k=> k===this.selectedDate);
        console.info(`Trufactor initialized with latest date: ${this.lastAvailableDate}`);
        console.info(`Trufactor dates available: ${this.datesAvailable}`)
        return true;
      });

    // if everything is cached this could be called thousands of times
    // in a millisecond, we debounce this so it doesn't bog down processing
    this.updateProgress = debounce(function updateProgress(progress){
      this.progress = progress*100;
    }.bind(this),50);
  }
  nextDate(){
    this.selectedDateIndex++;
    if(this.selectedDateIndex>this.datesAvailable.length-1){
      this.selectedDateIndex=0;
    } //end if
    this.selectedDate = this.datesAvailable[this.selectedDateIndex];
  }
  previousDate(){
    this.selectedDateIndex--;
    if(this.selectedDateIndex<0){
      this.selectedDateIndex=this.datesAvailable.length-1;
    } //end if
    this.selectedDate = this.datesAvailable[this.selectedDateIndex];
  }
  async getPointsOfInterest(query){
    const queryString = Object.keys(query).map(key=>{
      return `${key}=${query[key]}`;
    }).join('&');

    return await fetch(`${this.domain}/poi?${queryString}`).then(res=>res.json());
  }
  async getAddress(query){
    const queryString = Object.keys(query).map(key=>{
      return `${key}=${query[key]}`;
    }).join('&');

    return await fetch(`${this.domain}/address?${queryString}`).then(res=>res.json());
  }
  async getFuzzy(query){
    const queryString = Object.keys(query).map(key=>{
      return `${key}=${query[key]}`;
    }).join('&');

    return await fetch(`${this.domain}/fuzzy?${queryString}`).then(res=>res.json());
  }
  async getSpeechToText(){
    const speechConfig = SpeechConfig.fromAuthorizationToken(
      this.cognitiveToken,
      'centralus'
    );

    speechConfig.speechRecognitionLanguage = 'en-US';
    const audioConfig  = AudioConfig.fromDefaultMicrophoneInput(),
          recognizer = new SpeechRecognizer(speechConfig, audioConfig);

    return await new Promise((resolve,reject)=>{
      recognizer.recognizeOnceAsync(
        result=>{
          resolve(result);
          recognizer.close();
        },
        err=>{
          reject(err);
          recognizer.close();
        }
      );
    });
  }
  async getTextToSpeech(text=''){
    const xmlDoc = document.implementation.createDocument('','',null),
          speakElement = xmlDoc.createElement('speak'),
          voiceElement = xmlDoc.createElement('voice');

    speakElement.setAttribute('version', '1.0');
    speakElement.setAttribute('xml:lang', 'en-US');
    xmlDoc.appendChild(speakElement);
    voiceElement.setAttribute('name','en-US-Guy24kRUS'); //Jessa24kRUS
    voiceElement.setAttribute('xml:lang', 'en-US');
    voiceElement.textContent = text;
    speakElement.appendChild(voiceElement);

    const body = new XMLSerializer().serializeToString(xmlDoc),
          baseUrl = 'https://centralus.tts.speech.microsoft.com/',
          path = 'cognitiveservices/v1',
          uri = baseUrl+path,
          req = new XMLHttpRequest();

    req.open('POST', uri, true);
    req.responseType = 'blob';
    req.setRequestHeader('Authorization',`Bearer ${this.cognitiveToken}`);
    req.setRequestHeader('Content-Type','application/ssml+xml');
    req.setRequestHeader('X-Microsoft-OutputFormat','riff-24khz-16bit-mono-pcm');
    req.onreadystatechange = function(){
      if(req.readyState == 4 && req.status == 200) {
        const audioBlob = new Blob([req.response], {type: 'audio/wav'}),
              audioUrl = window.URL.createObjectURL(audioBlob);

        document.getElementById('ttsVoice').src = audioUrl;
        document.getElementById('ttsVoice').play();
      } //end if
    }; //end onreadystatechange()
    req.send(body);
  }
  async getIntent(command=''){
    const {entities,intents,query} = await fetch(`${this.domain}/luis?command=${command}`)
            .then(res=> res.json()),
          addresses = entities.filter(e=> e.role==='address'),
          states = entities.filter(e=> e.role==='state'),
          cities = entities.filter(e=> e.role==='city'),
          poi = entities.filter(e=> e.role==='poi'),
          isFuzzy = intents.find(e=> e.intent==='list'&&e.score>0.5),
          isBeingCompared = states.length===2||cities.length===2||poi.length===2,
          isBeingLookedUp = (states.length||cities.length||poi.length)
            &&!addresses.length&&!isFuzzy;

    // fail-first scenarios
    if(states.length>2||cities.length>2||poi.length>2){
      return {
        error: 'Can only compare two pois at a time.'
      };
    } //end if
    if(addresses.length>1){
      return {
        error: 'Can only lookup one address at a time.'
      };
    } //end if
    if(addresses.length&&!states.length){
      return {
        error: 'Missing state in address lookup.'
      };
    }else if(isBeingCompared&&!states.length){
      return {
        error: 'Missing state in poi comparison lookup.'
      };
    } //end if
    if(addresses.length&&!cities.length){
      return {
        error: 'Missing city in address lookup.'
      };
    }else if(isBeingCompared&&!cities.length){
      return {
        error: 'Missing city in poi comparison lookup.'
      };
    } //end if
    if(addresses.length&&isBeingCompared){
      return {
        error: 'Invalid format for address lookup.'
      };
    }else if(isBeingCompared&&!poi.length){
      return {
        error: 'Missing poi in poi comparison lookup.'
      };
    } //end if
    if(isBeingLookedUp&&!states.length){
      return {
        error: 'Missing state in poi lookup.'
      };
    } //end if
    if(isBeingLookedUp&&!cities.length){
      return {
        error: 'Missing city in poi lookup.'
      };
    } //end if
    if(isBeingLookedUp&&!poi.length){
      return {
        error: 'Missing poi in poi lookup.'
      };
    } //end if
    if(isFuzzy&&!poi.length){
      return {
        error: 'Missing poi in fuzzy search.'
      };
    } //end if
    const commands = intents
      .filter(e=> e.score>0.1)
      .reduce((result,command)=>{
        if(command.intent==='pan'){
          return [...result,{
            name: 'pan',
            direction: entities.find(e=> e.type==='cardinalDirection').role
          }];
        }else if(command.intent==='zoom'){
          const direction = entities.find(e=> e.type==='depthDirection'),
                amount = entities.find(e=> e.type==='depthDirectionAmount');

          return [...result,{
            name: 'zoom',
            direction: direction?direction.role:'inwards',
            amount: amount?amount.role:'little'
          }];
        }else if(command.intent==='reset'){
          return [...result,{name: 'reset'}];
        }else if(command.intent==='getDemographics'){
          return [...result,{name: 'show details'}];
        } //end if
        return result;
      },[]);

    if(isFuzzy){
      return {
        type: 'fuzzy search',
        address: addresses.length?addresses[0].entity:'',
        state: states.length?states[0].entity:'',
        city: cities.length?cities[0].entity:'',
        poi: poi[0].entity,
        commands
      };
    }else if(addresses.length){
      return {
        type: 'address lookup',
        address: addresses[0].entity,
        state: states[0].entity,
        city: cities[0].entity,
        poi: poi.length?poi[0].entity:'', //optional in addresses
        commands
      };
    }else if(isBeingCompared){
      return {
        type: 'poi comparison lookup',
        source: {
          state: states[0].entity,
          city: cities[0].entity,
          poi: poi[0].entity
        },
        target: {
          state: states.length===1?states[0].entity:states[1].entity,
          city: cities.length===1?cities[0].entity:cities[1].entity,
          poi: poi.length===1?poi[0].entity:poi[1].entity
        },
        commands
      };
    }else if(isBeingLookedUp){
      return {
        type: 'poi lookup',
        state: states[0].entity,
        city: cities[0].entity,
        poi: poi[0].entity,
        commands
      };
    }else if(commands.length){
      return {commands};
    }else{
      return {
        error: 'Unrecognized command or query.'
      };
    } //end if
  }
  cacheData({metadata,features=[],dryRun=false}={}){

    // we allow attaching of synchronous functions before the
    // caching of data
    if(typeof this.beforeCaching === 'function') this.beforeCaching({features});

    // Save the features results to indexeddb for faster look-up
    // If the metadata is missing, it's because it was a custom query
    if(!dryRun&&metadata){
      features.forEach(f=> set(f.properties.index,f));
      const foundData = features.map(f=> f.properties.index),
            missingData = metadata.queryIndexes.filter(i=> !foundData.includes(i));

      missingData.forEach(index=> set(index,null));
    } //end if

    // we allow attaching of synchronous functions after the
    // caching of data
    if(typeof this.afterCaching === 'function') this.afterCaching({features});
  }
  async getStrategy({query=[39.0977,-94.5786],zoom=2,date=this.selectedDate}={}){
    let h3Resolution = zoom<0.3?2:zoom<0.5?4:zoom<0.6?6:zoom<0.7?8:zoom<0.9?10:12;

    if(Array.isArray(query)&&query.length===2){ //point
      return [
        `${geoToH3(...query, h3Resolution)}${date}`
      ];
    } //end if

    // we convert the coordinates array into a tuple array of appropriate
    // lat/long combinations before polyfilling it/converting it into h3
    // indexes representing the hexagons included within/atop the lat longs
    const tupleCoordinates = query
      .reduce((result,cur,i)=>{
        if(i%2===0) return [...result,[cur]];
        result[(i-1)/2].push(cur);
        return result;
      },[]);

    let indexes = polyfill([tupleCoordinates],h3Resolution);

    // now we iteratively zoom outwards until all of the perspective hexagons
    // will fit into a single hex for performance reasons
    while(h3Resolution>2&&indexes.length>1000){
      h3Resolution-=2;
      indexes = polyfill([tupleCoordinates],h3Resolution);
    }

    // now we iteratively zoom back in until we meet our threshold requirement
    while(indexes.length<100){
      h3Resolution+=2;
      indexes = polyfill([tupleCoordinates],h3Resolution);
    }
    return indexes.map(index=> `${index}${date}`);
  }
  async getIndexes({indexes=[],dates=this.datesAvailable,filters=defaultFilters}={}){

    // fail-first
    if(!indexes.length||!dates.length){
      throw new Error('Index(es) and date(s) required for getIndexes.');
    } //end if
    const compositeIndexes = indexes.reduce((indexes,index)=>{
            return [
              ...indexes,
              ...dates.reduce((indexes,date)=>{
                return [...indexes,`${index}${date}`];
              },[])
            ];
          },[]),
          queryParts = [
            `age=${filters.age}`,
            `gender=${filters.gender}`,
            `ethnicity=${filters.ethnicity}`,
            `income=${filters.income}`
          ],
          pageLength = 2;

    // Call all subsequent missing data assets in parallel and allow them to come
    // back in their own time
    return {
      type: 'FeatureCollection',
      features: await Promise.all(
        new Array(Math.ceil(compositeIndexes.length/pageLength))
          .fill(null)
          .map((_,i)=>{
            const indexes = compositeIndexes
              .slice(i*pageLength,i*pageLength+pageLength)
              .join();

            return fetch(`${this.domain}?&${queryParts.join('&')}&indexes=${indexes}`)
              .then(res=> res.json())
              .then(res=> res.features);
          })
      ).then(args=> args.flat())
    };
  }
  async getData({
    query=[39.0997,-94.5786],zoom=2,filters=defaultFilters,date=this.selectedDate
  }={}){
    await this.loaded;

    // we allow attaching of synchronous functions before the intial
    // getData call
    if(typeof this.beforeGetData === 'function') this.beforeGetData();
    const coordinates = encodeURIComponent(query),
          queryParts = [
            `coordinates=${coordinates}`,
            `zoom=${zoom.toFixed(2)}`,
            `age=${filters.age}`,
            `gender=${filters.gender}`,
            `ethnicity=${filters.ethnicity}`,
            `income=${filters.income}`,
            `coverage=true`
          ];

    // Cancel any current requests before making the next batch
    this.queuedRequests.forEach(controller=> controller.abort());
    this.queuedRequests.length=0;

    // intialize the progress bar
    this.progress = 0;

    // we allow attaching of synchronous functions before the intial
    // strategy call
    if(typeof this.beforeStrategy === 'function') this.beforeStrategy();

    // Start by making a strategy request to discover what is cached
    // and what isn't
    const strategy = await this.getStrategy({query,zoom,date});


    // we allow attaching of synchronous functions in-between the
    // initial strategy call and the filling in of data
    if(typeof this.afterStrategy === 'function') this.afterStrategy(res);

    const pageLength = 50,
          totalIndexes = strategy.length;

    let queryIndexes = [],
        loadedIndexes = 0,
        features = [];

    // Start by creating indexeddb keys for the never-queried before indexes
    // indexes that don't have data will continue to stay null and never
    // be attempted again as the client knows the data doesn't exist. Existing
    // data will be fetched from indexeddb instead of polling the server
    await Promise.all(
      strategy.map(async index=>{
        const data = await get(index);

        if(data===undefined) return index;
        this.updateProgress(++loadedIndexes/totalIndexes);
        features.push(data);
        return data;
      })
    ).then(res=>{
      queryIndexes = res.filter(feature=> typeof feature==='string');

      // typeof feature==='string' <-- missing data
      // typeof feature===null <-- empty data
      // everything else is cached data
      const data = res.filter(feature=> typeof feature!=='string'&&feature!==null);

      // This will call any hooks attached to caching data that may be
      // awaiting data population while not actually caching anything since
      // it's cached already i.e. "Dry Run"
      this.cacheData({features: data, dryRun: true});
    })

    // we allow attaching of synchronous functions before the supplementary
    // data calls
    if(typeof this.beforeSupplementary === 'function') this.beforeSupplementary(features);

    // If we have all the data cached, there is no reason to make supplementary
    // data calls
    if(!queryIndexes.length){

      // we allow attaching of synchronous functions after the supplementary
      // data calls
      if(typeof this.afterSupplementary === 'function') this.afterSupplementary(features);
      return features;
    } //end if

    // Call all subsequent missing data assets in parallel and allow them to come
    // back in their own time
    await Promise.all(
      new Array(Math.ceil(queryIndexes.length/pageLength))
        .fill(null)
        .map((_,i)=>{
          const controller = new AbortController(),
                signal = controller.signal;

          this.queuedRequests.push(controller);
          const indexes = queryIndexes.slice(i*pageLength,i*pageLength+pageLength);

          return fetch(`${this.domain}?&${queryParts.join('&')}&indexes=${indexes}`,{signal})
            .then(async res=>{
              const data = await res.json();

              loadedIndexes+=indexes.length;
              this.updateProgress(loadedIndexes/totalIndexes);
              this.cacheData(data);
              features = [...features,...data.features];

              if(loadedIndexes/totalIndexes!==1) return; //short-circuit

              // we allow attaching of synchronous functions after the supplementary
              // data calls
              if(typeof this.afterSupplementary === 'function') this.afterSupplementary(features);
            });
        })
    );

    // we allow attaching of synchronous functions after the getData has been finished
    if(typeof this.afterGetData === 'function'){
      this.afterGetData({type: 'FeatureCollection', features});
    } //end if
    return {
      type: 'FeatureCollection',
      features
    };
  }
}


