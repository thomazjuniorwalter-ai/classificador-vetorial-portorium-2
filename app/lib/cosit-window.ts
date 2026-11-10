// Publication and decision dates remain separate inside the collectors.
export function collectionWindow(today:string,options:{from?:string;to?:string;reconcile?:boolean;startYear?:string}={}) {
  const valid=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
  if(!valid(today))throw Error('Data atual inválida');
  let to=options.to||today;
  let from=options.from||new Date(Date.parse(to)-60*86400000).toISOString().slice(0,10);
  if(options.reconcile&&!options.from&&!options.to) {
    const year=Number(today.slice(0,4)),first=Number(options.startYear);
    if(!Number.isInteger(first)||first<1990||first>year)throw Error('Configurar o primeiro ano da reconciliação histórica');
    const week=Math.floor(Date.parse(today)/(7*86400000));
    const target=first+week%(year-first+1);
    from=`${target}-01-01`;to=target===year?today:`${target}-12-31`;
  }
  if(!valid(from)||!valid(to)||from>to||to>today||Date.parse(to)-Date.parse(from)>366*86400000)
    throw Error('Janela inválida: use intervalos de até 366 dias, sem datas futuras');
  return {from,to};
}
