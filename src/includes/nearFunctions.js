import {BN} from 'bn.js'

export const ConvertToYoctoNear = (amount) => {
    return new BN(Math.round(amount * 100000000)).mul(new BN("10000000000000000")).toString();
};


export const ContractCallAlert = () => {
    alert(
        'Something went wrong! ' +
        'Maybe you need to sign out and back in? ' +
        'Check your browser console for more info.'
    );
};